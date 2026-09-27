/**
 * Retentive memory tags: a tag marked retentive keeps its last value from one
 * Run to the next. At the start of a Run the saved values are loaded and
 * preset into the driver in place of the tags' initial values; while it runs,
 * a keeper watches those tags and saves their values (a second after the last
 * change, and when the Run stops). The values live in the main process, in
 * userData/retentive/<store>.json (src/main/retentive/RetentiveStore.js).
 */
HmiRetentive = function() {};

/** Wait this long after a change before saving, so a burst is one write. */
HmiRetentive.SAVE_DELAY_MS = 1000;

HmiRetentive.isRetentive = function(tag)
{
	return tag != null && tag.retentive === true && !HmiTypes.isIO(tag.type);
};

HmiRetentive.tags = function(project)
{
	var names = [];

	for (var i = 0; i < project.tags.length; i++)
	{
		if (HmiRetentive.isRetentive(project.tags[i]))
		{
			names.push(project.tags[i].name);
		}
	}

	return names;
};

HmiRetentive.available = function()
{
	return window.electron != null && typeof window.electron.request === 'function';
};

HmiRetentive.request = function(action, args, fn, error)
{
	var msg = args || {};
	msg.action = action;
	window.electron.request(msg, fn, error);
};

/** The saved values, to fn(values); {} when there are none or no store. */
HmiRetentive.load = function(store, fn)
{
	if (!store || !HmiRetentive.available())
	{
		fn({});

		return;
	}

	HmiRetentive.request('hmiRetentive.load', {store: store}, function(values)
	{
		fn(values || {});
	}, function(message)
	{
		HmiLog.warn('retentive values not read: ' + message);
		fn({});
	});
};

HmiRetentive.clear = function(store, fn)
{
	HmiRetentive.request('hmiRetentive.clear', {store: store}, function() { fn(null); },
		function(message) { fn(message); });
};

/**
 * Saves the retentive tags' values while a Run goes on.
 *
 * @param project  the HmiProject
 * @param driver   a driver or hub client
 * @param options  {store, values (loaded at start), persist(values) (default:
 *                 the main process)}
 */
HmiRetentiveKeeper = function(project, driver, options)
{
	this.project = project;
	this.driver = driver;
	this.options = options || {};
	this.values = {};
	this.timer = null;
	this.dirty = false;

	// Saved values for tags no longer retentive or renamed are dropped: only
	// the project's retentive tags are kept
	var names = HmiRetentive.tags(project);
	var loaded = this.options.values || {};

	for (var i = 0; i < names.length; i++)
	{
		for (var key in loaded)
		{
			if (key.toLowerCase() === names[i].toLowerCase())
			{
				this.values[names[i]] = loaded[key];
			}
		}
	}
};

HmiRetentiveKeeper.prototype.start = function()
{
	var names = HmiRetentive.tags(this.project);

	if (names.length === 0)
	{
		return;
	}

	var that = this;
	this.onChange = function(batch) { that.applyBatch(batch); };
	this.driver.on('change', this.onChange);
	this.driver.subscribe(names, 250);
	this.running = true;
};

HmiRetentiveKeeper.prototype.stop = function()
{
	if (!this.running)
	{
		return;
	}

	this.running = false;
	this.driver.off('change', this.onChange);
	this.driver.unsubscribe();
	this.flush();
};

HmiRetentiveKeeper.prototype.applyBatch = function(batch)
{
	for (var name in batch)
	{
		var tag = this.project.getTag(name);
		var v = batch[name];

		// Only good values are worth keeping
		if (HmiRetentive.isRetentive(tag) && v != null && v.quality > HmiTypes.QUALITY_BAD &&
			this.values[tag.name] !== v.value)
		{
			this.values[tag.name] = v.value;
			this.dirty = true;
		}
	}

	if (this.dirty && this.timer == null)
	{
		var that = this;

		this.timer = window.setTimeout(function()
		{
			that.timer = null;
			that.flush();
		}, HmiRetentive.SAVE_DELAY_MS);
	}
};

HmiRetentiveKeeper.prototype.flush = function()
{
	if (this.timer != null)
	{
		window.clearTimeout(this.timer);
		this.timer = null;
	}

	if (!this.dirty)
	{
		return;
	}

	this.dirty = false;
	var values = {};

	for (var name in this.values)
	{
		values[name] = this.values[name];
	}

	if (this.options.persist != null)
	{
		this.options.persist(values);
	}
	else if (this.options.store && HmiRetentive.available())
	{
		HmiRetentive.request('hmiRetentive.save', {store: this.options.store, values: values},
			function() {}, function(message)
		{
			HmiLog.once('retentive.save', 'retentive values not saved: ' + message);
		});
	}
};
