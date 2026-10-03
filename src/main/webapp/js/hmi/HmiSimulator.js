/**
 * In-renderer tag simulator.
 *
 * The shipping drivers live in the Electron main process behind an IPC
 * boundary, because real protocols need raw sockets and a polling loop should
 * not contend with the render thread. This one deliberately does not: it
 * exists so the animation engine can be developed and tested without also
 * depending on the IPC design, and it implements the same contract so that
 * swapping in the real thing changes no runtime code.
 */
HmiSimulator = function(project)
{
	this.project = project;
	this.values = {};
	this.listeners = [];
	this.timer = null;
	this.rateMs = 250;
	this.t0 = Date.now();

	// Tags forced to bad quality, for testing how links behave when the data
	// is untrustworthy. Getting this wrong is the classic HMI failure, so it
	// is testable from the start rather than after the first real driver.
	this.faulted = {};
	this.frozen = false;

	// Starting values in place of the tags' initial values (retentive tags,
	// see HmiRetentive), by lower-case name
	this.presets = {};
};

/** Values the next connect starts memory tags at, instead of their initial values. */
HmiSimulator.prototype.preset = function(values)
{
	this.presets = {};

	for (var name in (values || {}))
	{
		this.presets[name.toLowerCase()] = values[name];
	}
};

/** A stored value made to fit the tag's type now, or null when it cannot. */
HmiSimulator.coerce = function(tag, value)
{
	if (HmiTypes.isDiscrete(tag.type))
	{
		return (value === true || value === 1 || value === '1' || value === 'true') ? 1 : 0;
	}

	if (HmiTypes.isAnalog(tag.type))
	{
		var n = parseFloat(value);

		return isNaN(n) ? null : n;
	}

	return (value != null) ? String(value) : null;
};

/** A tag's starting value: its initial value, or "" (message) or 0. An empty message stays text. */
HmiSimulator.initialOf = function(tag)
{
	if (tag.initial != null && tag.initial !== '')
	{
		return tag.initial;
	}

	return (HmiTypes.isMessage(tag.type)) ? '' : 0;
};

HmiSimulator.prototype.id = 'simulator';
HmiSimulator.prototype.displayName = 'Simulator';

HmiSimulator.prototype.connect = function()
{
	var tags = this.project.tags;

	for (var i = 0; i < tags.length; i++)
	{
		var key = tags[i].name.toLowerCase();
		var start = HmiSimulator.initialOf(tags[i]);

		if (this.presets[key] !== undefined && !HmiTypes.isIO(tags[i].type))
		{
			var kept = HmiSimulator.coerce(tags[i], this.presets[key]);

			if (kept != null)
			{
				start = kept;
			}
		}

		this.values[key] = {
			value: start,
			quality: HmiTypes.QUALITY_GOOD,
			timestamp: Date.now()
		};
	}

	this.status_ = 'connected';
};

HmiSimulator.prototype.disconnect = function()
{
	this.unsubscribe();
	this.status_ = 'disconnected';
};

HmiSimulator.prototype.status = function()
{
	return this.status_ || 'disconnected';
};

HmiSimulator.prototype.on = function(event, cb)
{
	this.listeners.push({event: event, cb: cb});
};

HmiSimulator.prototype.off = function(event, cb)
{
	for (var i = this.listeners.length - 1; i >= 0; i--)
	{
		if (this.listeners[i].event === event && this.listeners[i].cb === cb)
		{
			this.listeners.splice(i, 1);
		}
	}
};

HmiSimulator.prototype.emit = function(event, payload)
{
	for (var i = 0; i < this.listeners.length; i++)
	{
		if (this.listeners[i].event === event)
		{
			this.listeners[i].cb(payload);
		}
	}
};

HmiSimulator.prototype.subscribe = function(paths, rateMs)
{
	this.rateMs = rateMs || 250;
	this.unsubscribe();

	// A subscription opens with a full snapshot of everything asked for, not
	// with the first delta. Otherwise a tag that never changes -- a memory
	// discrete sitting at its initial value, say -- is never sent at all, and
	// the subscriber's cache holds null for it forever. That makes a
	// pushbutton read null instead of 0 and a value display show nothing,
	// which looks exactly like a dead link.
	var snapshot = {};

	for (var i = 0; i < paths.length; i++)
	{
		var tag = this.project.getTag(paths[i]);

		if (tag != null)
		{
			snapshot[tag.name] = this.get(tag.name);
		}
	}

	if (Object.keys(snapshot).length > 0)
	{
		this.emit('change', snapshot);
	}

	var that = this;
	this.timer = window.setInterval(function() { that.scan(); }, this.rateMs);
	this.scan();

	return 'sim1';
};

HmiSimulator.prototype.unsubscribe = function()
{
	if (this.timer != null)
	{
		window.clearInterval(this.timer);
		this.timer = null;
	}
};

HmiSimulator.prototype.read = function(paths)
{
	var res = {};

	for (var i = 0; i < paths.length; i++)
	{
		res[paths[i]] = this.get(paths[i]);
	}

	return res;
};

HmiSimulator.prototype.get = function(name)
{
	var v = this.values[('' + name).toLowerCase()];

	return (v != null) ? v :
		{value: null, quality: HmiTypes.QUALITY_BAD, timestamp: Date.now()};
};

/**
 * Writes take effect immediately and are held until the next scan overwrites
 * them, which is what makes pushbuttons demonstrable without a PLC.
 */
HmiSimulator.prototype.write = function(writes)
{
	var res = {};
	var batch = {};

	for (var name in writes)
	{
		var tag = this.project.getTag(name);

		if (tag == null)
		{
			res[name] = {ok: false, error: 'Unknown tag'};
			continue;
		}

		var value = writes[name];

		if (HmiTypes.isDiscrete(tag.type))
		{
			value = (value) ? 1 : 0;
		}
		else if (HmiTypes.isAnalog(tag.type))
		{
			value = parseFloat(value);

			if (isNaN(value))
			{
				res[name] = {ok: false, error: 'Not a number'};
				continue;
			}

			if (HmiTypes.isInteger(tag.type))
			{
				value = Math.round(value);
			}
		}

		var entry = {value: value, quality: HmiTypes.QUALITY_GOOD,
			timestamp: Date.now()};
		this.values[tag.name.toLowerCase()] = entry;
		batch[tag.name] = entry;
		res[name] = {ok: true};
	}

	if (Object.keys(batch).length > 0)
	{
		this.emit('change', batch);
	}

	return res;
};

// ------------------------------------------------------------------ scan

HmiSimulator.prototype.scan = function()
{
	if (this.frozen)
	{
		return;
	}

	var now = Date.now();
	var elapsed = now - this.t0;
	var changed = {};

	for (var i = 0; i < this.project.tags.length; i++)
	{
		var tag = this.project.tags[i];
		var key = tag.name.toLowerCase();
		var prev = this.values[key];
		var next = this.simulate(tag, elapsed, prev);

		if (this.faulted[key])
		{
			next = {value: (prev != null) ? prev.value : null,
				quality: HmiTypes.QUALITY_BAD, timestamp: now};
		}

		// Change detection belongs to the driver, not the renderer: it is
		// closer to the data and a real driver can use protocol-level events.
		if (prev == null || prev.value !== next.value ||
			prev.quality !== next.quality)
		{
			this.values[key] = next;
			changed[tag.name] = next;
		}
	}

	if (Object.keys(changed).length > 0)
	{
		this.emit('change', changed);
	}
};

/**
 * I/O tags follow a profile by default, so a new screen animates at once.
 *
 * Memory tags hold whatever was last written, because that is what a memory
 * tag is for -- a pushbutton or a script owns it, and a waveform would fight
 * whoever wrote it. But an explicitly chosen mode is honoured on them too:
 * driving a memory tag is how a screen gets tested before any PLC exists, and
 * the dictionary offers the Simulation section on every tag type, so ignoring
 * it there would be the field lying about what it does.
 */
HmiSimulator.prototype.simulate = function(tag, elapsed, prev)
{
	var now = Date.now();

	var sim = tag.sim || {};
	var mode = sim.mode;

	if (!HmiTypes.isIO(tag.type) && (mode == null || mode === ''))
	{
		return (prev != null) ? prev :
			{value: HmiSimulator.initialOf(tag), quality: HmiTypes.QUALITY_GOOD,
				timestamp: now};
	}

	var period = parseFloat(sim.periodMs);

	if (isNaN(period) || period <= 0)
	{
		period = (HmiTypes.isDiscrete(tag.type)) ? 5000 : 30000;
	}

	if (mode == null)
	{
		mode = (HmiTypes.isDiscrete(tag.type)) ? 'toggle' :
			((HmiTypes.isMessage(tag.type)) ? 'static' : 'sine');
	}

	var min = (sim.min != null && sim.min !== '') ? parseFloat(sim.min) :
		((tag.minEU != null) ? tag.minEU : 0);
	var max = (sim.max != null && sim.max !== '') ? parseFloat(sim.max) :
		((tag.maxEU != null) ? tag.maxEU : 100);

	var phase = (elapsed % period) / period;
	var value;

	if (mode === 'toggle')
	{
		value = (phase < 0.5) ? 0 : 1;
	}
	else if (mode === 'ramp')
	{
		value = min + (max - min) * phase;
	}
	else if (mode === 'random')
	{
		value = min + (max - min) * Math.random();
	}
	else if (mode === 'static')
	{
		return (prev != null) ? prev :
			{value: HmiSimulator.initialOf(tag), quality: HmiTypes.QUALITY_GOOD,
				timestamp: now};
	}
	else
	{
		// sine
		value = min + (max - min) *
			(0.5 - 0.5 * Math.cos(phase * 2 * Math.PI));
	}

	if (HmiTypes.isInteger(tag.type) || HmiTypes.isDiscrete(tag.type))
	{
		value = Math.round(value);
	}
	else
	{
		value = Math.round(value * 1000) / 1000;
	}

	return {value: value, quality: HmiTypes.QUALITY_GOOD, timestamp: now};
};

// ------------------------------------------------------- fault injection

HmiSimulator.prototype.setFaulted = function(name, faulted)
{
	this.faulted[('' + name).toLowerCase()] = !!faulted;
};

HmiSimulator.prototype.setFrozen = function(frozen)
{
	this.frozen = !!frozen;
};
