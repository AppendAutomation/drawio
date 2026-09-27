/**
 * The runtime's driver: one contract (HmiSimulator's), two sources.
 *
 * Memory tags, and I/O tags on a simulated device, live in an inner
 * HmiSimulator. I/O tags on a real device go to the hmi-comms server through
 * the Electron main process, configured with their device, address and
 * raw-to-engineering scaling, and polled at their device's scan rate. The
 * runtime sees one driver either way.
 *
 * The server is asynchronous where the contract is not: its snapshot arrives
 * a moment after subscribe (the runtime caches, so that is fine), and write()
 * cannot wait for the device, so a write to a real device reports
 * {ok: true, pending: true} and a later failure is logged and raised as a
 * 'writeError' event.
 */
HmiCommsDriver = function(project)
{
	this.project = project;
	this.sim = new HmiSimulator(project);
	this.listeners = [];
	this.values = {};
	this.remote = {};
	this.deviceStatus = {};
	this.status_ = 'disconnected';
	this.configured = false;
	this.waiting = [];
	this.remoteWanted = null;

	var that = this;

	// The simulator scans every tag in the project; only the ones it owns
	// may reach the runtime, or it would overwrite device values.
	this.onSim = function(batch)
	{
		var own = {};

		for (var name in batch)
		{
			if (that.remoteTag(name) == null)
			{
				own[name] = batch[name];
			}
		}

		that.accept(own);
	};

	this.onServer = function(ev)
	{
		that.serverEvent(ev);
	};
};

HmiCommsDriver.prototype.id = 'comms';
HmiCommsDriver.prototype.displayName = 'Devices';

/** True when a tag's value comes from the comms server rather than the simulator. */
HmiCommsDriver.prototype.isRemote = function(tag)
{
	var device = this.project.deviceOf(tag);

	return device != null && device.protocol !== 'simulator';
};

HmiCommsDriver.prototype.remoteTag = function(name)
{
	return this.remote[('' + name).toLowerCase()] || null;
};

// ------------------------------------------------------------ lifecycle

/** Starting values for memory tags (see HmiSimulator.preset). */
HmiCommsDriver.prototype.preset = function(values)
{
	this.sim.preset(values);
};

HmiCommsDriver.prototype.connect = function()
{
	this.sim.on('change', this.onSim);
	this.sim.connect();

	var devices = [];
	var tags = [];
	var used = {};

	for (var i = 0; i < this.project.tags.length; i++)
	{
		var tag = this.project.tags[i];

		if (!this.isRemote(tag))
		{
			continue;
		}

		var device = this.project.deviceOf(tag);
		this.remote[tag.name.toLowerCase()] = tag;

		if (!used[device.name.toLowerCase()])
		{
			used[device.name.toLowerCase()] = true;
			devices.push(HmiComms.deviceConfig(device));
		}

		tags.push(HmiCommsDriver.tagConfig(tag));
	}

	this.status_ = 'connected';

	if (tags.length === 0)
	{
		this.ready();

		return;
	}

	if (!HmiComms.available())
	{
		HmiLog.once('comms:unavailable', 'device tags need the desktop app; they will show bad quality');
		this.markRemote('unavailable', 'PLC communications need the desktop app');
		this.ready();

		return;
	}

	HmiComms.onEvent(this.onServer);

	var that = this;

	HmiComms.request('configure', {devices: devices, tags: tags}, function(result, error)
	{
		if (error != null)
		{
			HmiLog.warn('comms: ' + error);
			that.markRemote('comm', error);
		}
		else
		{
			// Tags the server could not bind -- a bad address, an unusable
			// device -- are bad from the start, with its reason.
			var batch = {};

			for (var i = 0; i < result.tags.length; i++)
			{
				var t = result.tags[i];

				if (t.error)
				{
					HmiLog.once('comms:tag:' + t.id, t.id + ': ' + t.error);
					batch[t.id] = {value: null, quality: HmiTypes.QUALITY_BAD, timestamp: Date.now(),
						status: 'config', error: t.error};
				}
			}

			that.accept(batch);
		}

		that.ready();
	});
};

/** A project tag as the server's configure message describes it. */
HmiCommsDriver.tagConfig = function(tag)
{
	var cfg = {id: tag.name, device: tag.device, address: tag.address || '',
		dataType: HmiComms.dataTypeHint(tag)};

	// Raw-to-engineering scaling for analog I/O, only when the tag asks for
	// it, done by the server so that writes are scaled back the same way.
	if (tag.scaled === true && HmiTypes.isAnalog(tag.type) && tag.minRaw != null && tag.maxRaw != null &&
		tag.minEU != null && tag.maxEU != null &&
		!(tag.minRaw == tag.minEU && tag.maxRaw == tag.maxEU))
	{
		cfg.scale = {rawMin: parseFloat(tag.minRaw), rawMax: parseFloat(tag.maxRaw),
			euMin: parseFloat(tag.minEU), euMax: parseFloat(tag.maxEU)};
	}

	return cfg;
};

/** Runs what was waiting for the configuration to settle. */
HmiCommsDriver.prototype.ready = function()
{
	this.configured = true;
	var waiting = this.waiting;
	this.waiting = [];

	for (var i = 0; i < waiting.length; i++)
	{
		waiting[i]();
	}
};

HmiCommsDriver.prototype.whenConfigured = function(fn)
{
	if (this.configured)
	{
		fn();
	}
	else
	{
		this.waiting.push(fn);
	}
};

HmiCommsDriver.prototype.disconnect = function()
{
	this.sim.off('change', this.onSim);
	this.sim.disconnect();
	HmiComms.offEvent(this.onServer);

	if (Object.keys(this.remote).length > 0 && HmiComms.available())
	{
		HmiComms.request('disconnect', {}, function() {});
	}

	this.remote = {};
	this.configured = false;
	this.waiting = [];
	this.status_ = 'disconnected';
};

HmiCommsDriver.prototype.status = function()
{
	return this.status_;
};

// ------------------------------------------------------------ events

HmiCommsDriver.prototype.on = function(event, cb)
{
	this.listeners.push({event: event, cb: cb});
};

HmiCommsDriver.prototype.off = function(event, cb)
{
	for (var i = this.listeners.length - 1; i >= 0; i--)
	{
		if (this.listeners[i].event === event && this.listeners[i].cb === cb)
		{
			this.listeners.splice(i, 1);
		}
	}
};

HmiCommsDriver.prototype.emit = function(event, payload)
{
	var list = this.listeners.slice(0);

	for (var i = 0; i < list.length; i++)
	{
		if (list[i].event === event)
		{
			list[i].cb(payload);
		}
	}
};

/** Caches a batch of values and passes it on. */
HmiCommsDriver.prototype.accept = function(batch)
{
	var any = false;

	for (var name in batch)
	{
		this.values[name.toLowerCase()] = batch[name];
		any = true;
	}

	if (any)
	{
		this.emit('change', batch);
	}
};

HmiCommsDriver.prototype.serverEvent = function(ev)
{
	if (ev.t === 'snapshot' || ev.t === 'change')
	{
		var batch = {};

		for (var id in ev.values)
		{
			var tag = this.remoteTag(id);

			if (tag != null)
			{
				batch[tag.name] = HmiCommsDriver.toValue(tag, ev.values[id]);
			}
		}

		this.accept(batch);
	}
	else if (ev.t === 'status')
	{
		for (var i = 0; i < ev.devices.length; i++)
		{
			var d = ev.devices[i];
			var before = this.deviceStatus[d.name];

			if (d.state === 'backoff' && (before == null || before.state !== 'backoff' ||
				before.lastError !== d.lastError))
			{
				HmiLog.warn(d.name + ': ' + (d.lastError || 'not communicating'));
			}
			else if (d.state === 'connected' && before != null && before.state !== 'connected')
			{
				HmiLog.log(d.name + ': communicating');
			}

			this.deviceStatus[d.name] = d;
		}

		this.emit('status', this.deviceStatus);
	}
	else if (ev.t === 'server' && ev.state === 'disconnected')
	{
		this.markRemote('comm', 'Comms server stopped; restarting');
	}
};

/** [value, quality, timestamp, status?, error?] to the runtime's value object. */
HmiCommsDriver.toValue = function(tag, tuple)
{
	var v = tuple[0];

	// Discrete tags are 0/1 throughout the runtime.
	if (HmiTypes.isDiscrete(tag.type) && v != null)
	{
		v = (v === true || v === 'true' || (typeof v === 'number' && v !== 0)) ? 1 : 0;
	}
	else if (HmiTypes.isAnalog(tag.type) && typeof v === 'string' && v !== '')
	{
		// 64-bit integers beyond 2^53 arrive as strings.
		v = parseFloat(v);
	}

	var value = {value: v, quality: tuple[1], timestamp: tuple[2]};

	if (tuple.length > 3)
	{
		value.status = tuple[3];
		value.error = tuple[4];
	}

	return value;
};

/** Every device tag bad at once: the server is gone or never came. */
HmiCommsDriver.prototype.markRemote = function(status, error)
{
	var batch = {};

	for (var key in this.remote)
	{
		batch[this.remote[key].name] = {value: null, quality: HmiTypes.QUALITY_BAD,
			timestamp: Date.now(), status: status, error: error};
	}

	this.accept(batch);
};

// ------------------------------------------------------------ data

HmiCommsDriver.prototype.subscribe = function(paths, rateMs)
{
	var local = [];
	var ids = [];
	var rates = {};

	for (var i = 0; i < paths.length; i++)
	{
		var tag = this.remoteTag(paths[i]);

		if (tag == null)
		{
			local.push(paths[i]);
		}
		else
		{
			ids.push(tag.name);
			var device = this.project.deviceOf(tag);

			if (device != null && device.scanMs > 0)
			{
				rates[tag.name] = device.scanMs;
			}
		}
	}

	// The simulator snapshots its tags synchronously, as the contract asks.
	this.sim.subscribe(local, rateMs);
	this.remoteWanted = ids;

	if (ids.length > 0 && HmiComms.available())
	{
		var that = this;

		this.whenConfigured(function()
		{
			// Only the latest subscription matters if several queued up.
			if (that.remoteWanted !== ids)
			{
				return;
			}

			HmiComms.request('subscribe', {ids: ids, rateMs: rateMs, rates: rates}, function(r, error)
			{
				if (error != null)
				{
					HmiLog.warn('comms subscribe: ' + error);
				}
			});
		});
	}

	return 'comms';
};

HmiCommsDriver.prototype.unsubscribe = function()
{
	this.sim.unsubscribe();
	this.remoteWanted = null;

	if (this.configured && Object.keys(this.remote).length > 0 && HmiComms.available())
	{
		HmiComms.request('unsubscribe', {}, function() {});
	}
};

HmiCommsDriver.prototype.get = function(name)
{
	var v = this.values[('' + name).toLowerCase()];

	return (v != null) ? v : {value: null, quality: HmiTypes.QUALITY_BAD, timestamp: Date.now()};
};

HmiCommsDriver.prototype.read = function(paths)
{
	var res = {};

	for (var i = 0; i < paths.length; i++)
	{
		res[paths[i]] = this.get(paths[i]);
	}

	return res;
};

/**
 * Local writes resolve at once. Device writes are sent and reported as
 * pending; a device's refusal comes back later as a 'writeError' event.
 */
HmiCommsDriver.prototype.write = function(writes)
{
	var local = {};
	var remote = {};
	var hasLocal = false;
	var hasRemote = false;
	var results = {};

	for (var name in writes)
	{
		var tag = this.remoteTag(name);

		if (tag == null)
		{
			local[name] = writes[name];
			hasLocal = true;
		}
		else if (!HmiComms.available())
		{
			results[name] = {ok: false, error: 'PLC communications need the desktop app'};
		}
		else
		{
			var v = writes[name];

			if (HmiTypes.isDiscrete(tag.type))
			{
				v = (v === true || v === 1 || v === '1' || v === 'true') ? true : false;
			}

			remote[tag.name] = v;
			results[name] = {ok: true, pending: true};
			hasRemote = true;
		}
	}

	if (hasLocal)
	{
		var sim = this.sim.write(local);

		for (var k in sim)
		{
			results[k] = sim[k];
		}
	}

	if (hasRemote)
	{
		this.writeAsync(remote);
	}

	return results;
};

/**
 * Writes to devices; callback(results) with each device's answer when given.
 * Failures are also logged and raised as 'writeError' {name, error}.
 */
HmiCommsDriver.prototype.writeAsync = function(values, callback)
{
	var that = this;

	HmiComms.request('write', {values: values}, function(r, error)
	{
		var results = {};

		for (var name in values)
		{
			var res = (error != null) ? {ok: false, error: error} :
				((r.results && r.results[name]) || {ok: false, error: 'No result'});
			results[name] = res;

			if (!res.ok)
			{
				HmiLog.warn('write ' + name + ' failed: ' + res.error);
				that.emit('writeError', {name: name, error: res.error});
			}
		}

		if (callback != null)
		{
			callback(results);
		}
	});
};
