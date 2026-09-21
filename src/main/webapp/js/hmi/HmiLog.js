/**
 * Logging and the guard-and-degrade helper.
 *
 * Every override this fork installs into upstream prototypes must go through
 * HmiLog.guard. If upstream changes shape under us, the HMI feature involved
 * disappears and logs once; the editor itself keeps working.
 */
HmiLog = function() {};

HmiLog.PREFIX = '[hmi] ';

/** Keys already logged, so a per-frame failure cannot flood the console. */
HmiLog.seen = {};

/** Bounded ring buffer surfaced in HMI > Runtime Log. */
HmiLog.ring = [];
HmiLog.RING_MAX = 500;

HmiLog.log = function(msg)
{
	HmiLog.record('info', msg);

	if (window.console != null)
	{
		console.log(HmiLog.PREFIX + msg);
	}
};

HmiLog.warn = function(msg)
{
	HmiLog.record('warn', msg);

	if (window.console != null)
	{
		console.warn(HmiLog.PREFIX + msg);
	}
};

/**
 * Logs once per key. Use for anything that can repeat at scan rate.
 */
HmiLog.once = function(key, msg)
{
	if (HmiLog.seen[key])
	{
		return;
	}

	HmiLog.seen[key] = true;
	HmiLog.warn(key + ': ' + ((msg != null && msg.message != null) ? msg.message : msg));
};

HmiLog.record = function(level, msg)
{
	HmiLog.ring.push({level: level, msg: '' + msg, t: Date.now()});

	if (HmiLog.ring.length > HmiLog.RING_MAX)
	{
		HmiLog.ring.shift();
	}
};

/**
 * Runs fn, swallowing and logging anything it throws.
 *
 * This is the mechanism behind the fork's central rule: an override must never
 * be able to break the editor it is layered onto.
 *
 * @param {string} key stable identifier, also the dedup key
 * @param {Function} fn
 * @param {*} fallback returned if fn throws
 */
HmiLog.guard = function(key, fn, fallback)
{
	try
	{
		return fn();
	}
	catch (e)
	{
		HmiLog.once(key, e);

		return fallback;
	}
};
