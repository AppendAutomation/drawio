/**
 * The renderer's access to the hmi-comms PLC server, through the Electron
 * main process (the page itself never opens a socket).
 *
 * Requests go out as electron.request({action: 'hmiComms.<name>', ...});
 * pushes -- value changes, snapshots, device status, server restarts -- come
 * back on the 'hmiCommsEvent' channel and are fanned out to listeners here.
 */
HmiComms = function() {};

HmiComms.listeners = [];
HmiComms.installed = false;

/** True in the desktop app, where the server can be reached. */
HmiComms.available = function()
{
	return typeof window !== 'undefined' && window.electron != null &&
		typeof window.electron.request === 'function';
};

/**
 * Sends a request. callback(result, error): exactly one of them is set.
 */
HmiComms.request = function(action, args, callback)
{
	if (!HmiComms.available())
	{
		callback(null, 'PLC communications need the desktop app');

		return;
	}

	var msg = {action: 'hmiComms.' + action};

	for (var k in args)
	{
		msg[k] = args[k];
	}

	window.electron.request(msg, function(result)
	{
		callback(result, null);
	}, function(e)
	{
		callback(null, (e != null && e.message) ? e.message : ('' + (e || 'hmi-comms request failed')));
	});
};

/** Adds a listener for server pushes: {t: 'snapshot'|'change'|'status'|'server', ...}. */
HmiComms.onEvent = function(listener)
{
	HmiComms.install();
	HmiComms.listeners.push(listener);
};

HmiComms.offEvent = function(listener)
{
	var i = mxUtils.indexOf(HmiComms.listeners, listener);

	if (i >= 0)
	{
		HmiComms.listeners.splice(i, 1);
	}
};

HmiComms.install = function()
{
	if (HmiComms.installed || !HmiComms.available() ||
		typeof window.electron.registerMsgListener !== 'function')
	{
		return;
	}

	HmiComms.installed = true;

	window.electron.registerMsgListener('hmiCommsEvent', function(ev)
	{
		var list = HmiComms.listeners.slice(0);

		for (var i = 0; i < list.length; i++)
		{
			try
			{
				list[i](ev);
			}
			catch (e)
			{
				HmiLog.warn('comms listener: ' + e.message);
			}
		}
	});
};

/** A project device as the server's configure message describes it. */
HmiComms.deviceConfig = function(d)
{
	var options = {};

	for (var k in (d.options || {}))
	{
		options[k] = d.options[k];
	}

	return {name: d.name, protocol: d.protocol, host: d.host || '', port: d.port,
		timeoutMs: d.timeoutMs || 3000, enabled: d.enabled !== false, options: options};
};

/**
 * What the tag's type says about the value, for protocols whose addresses do
 * not: HR:0 on an IOReal tag is a FLOAT, on an IOInteger an INT16.
 */
HmiComms.dataTypeHint = function(tag)
{
	switch (tag != null ? tag.type : null)
	{
		case 'IODiscrete':
			return 'BOOL';
		case 'IOReal':
			return 'REAL';
		case 'IOMessage':
			return 'STRING';
		default:
			return null;
	}
};

/** Checks addresses against a device's protocol. callback(results, error). */
HmiComms.validate = function(device, addresses, dataType, callback)
{
	HmiComms.request('validate', {protocol: device.protocol, addresses: addresses,
		options: HmiComms.deviceConfig(device).options, dataType: dataType}, function(r, error)
	{
		callback(r != null ? r.results : null, error);
	});
};

/** Tries a device's connection. callback({ok, error, ms}). */
HmiComms.probe = function(device, callback)
{
	HmiComms.request('probe', {device: HmiComms.deviceConfig(device)}, function(r, error)
	{
		callback(r != null ? r : {ok: false, error: error, ms: 0});
	});
};
