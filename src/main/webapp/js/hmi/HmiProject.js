/**
 * The HMI project model: devices, the tag dictionary, the application
 * settings and the display properties of each window (page).
 *
 * Serialization lives entirely behind toXml/fromXml so that if the
 * <hmiProject> child of <mxfile> ever proves unable to survive a save path,
 * switching to the hidden-page fallback is a change to this file alone.
 */
HmiProject = function()
{
	this.devices = [];
	this.tags = [];
	this.tagIndex = {};

	// Windows are pages, keyed by page id rather than name so that renaming a
	// page keeps its properties and its place in the startup list.
	this.settings = HmiProject.defaultSettings();
	this.windows = {};

	// Compilation resolves tag names against this dictionary, so the expression
	// cache is keyed on both of these. The uid is needed as well as the
	// revision because two different projects can easily sit at the same
	// revision -- a freshly loaded file and a freshly built one, say -- and
	// keying on the revision alone serves one project's compile to the other.
	this.uid = 'p' + (++HmiProject.uidCounter);
	this.revision = 0;
};

HmiProject.uidCounter = 0;

HmiProject.prototype.touch = function()
{
	this.revision++;
};

HmiProject.FORMAT_VERSION = '1';

/** Attribute on the cell's <object> node holding its animation links. */
HmiProject.CELL_ATTRIBUTE = 'hmi';

HmiProject.prototype.isEmpty = function()
{
	var d = HmiProject.defaultSettings();

	return this.tags.length === 0 && this.devices.length === 0 &&
		this.settings.width === d.width && this.settings.height === d.height &&
		this.settings.startup.length === 0 &&
		Object.keys(this.windows).length === 0;
};

// ------------------------------------------------------ application settings

/** Target screen resolutions offered in Application Settings. */
HmiProject.RESOLUTIONS = [
	[640, 480], [800, 480], [800, 600], [1024, 600], [1024, 768],
	[1280, 720], [1280, 800], [1280, 1024], [1366, 768], [1440, 900],
	[1600, 900], [1680, 1050], [1920, 1080], [1920, 1200]];

HmiProject.defaultSettings = function()
{
	return {width: 1024, height: 768, startup: []};
};

// ---------------------------------------------------------------- windows

/**
 * Window types, as in InTouch. A replace window closes every window it
 * overlaps when it opens; an overlay window opens on top of them; a popup
 * opens on top of everything and is modal -- nothing beneath it can be touched
 * until it closes.
 */
HmiProject.WINDOW_TYPES = ['replace', 'overlay', 'popup'];

HmiProject.TITLE_BAR_HEIGHT = 24;

/** Window scripts, stored as child elements so multi-line text stays legible. */
HmiProject.WINDOW_SCRIPTS = ['onShow', 'whileShowing', 'onHide'];

HmiProject.DEFAULT_WINDOW_EVERY_MS = '1000';

/**
 * The display properties of a window, with defaults filled in. Never null.
 *
 * An unset width or height follows the screen resolution, so a window nobody
 * has configured fills the screen, and keeps filling it when the resolution
 * changes.
 */
HmiProject.prototype.getWindow = function(pageId)
{
	var w = this.windows[pageId] || {};

	return {
		titleBar: w.titleBar === true,
		type: (mxUtils.indexOf(HmiProject.WINDOW_TYPES, w.type) >= 0) ?
			w.type : 'replace',
		x: (w.x != null) ? w.x : 0,
		y: (w.y != null) ? w.y : 0,
		width: (w.width != null) ? w.width : this.settings.width,
		height: (w.height != null) ? w.height : this.settings.height,
		onShow: w.onShow || '',
		whileShowing: w.whileShowing || '',
		everyMs: (w.everyMs != null && w.everyMs !== '') ? w.everyMs :
			HmiProject.DEFAULT_WINDOW_EVERY_MS,
		onHide: w.onHide || ''
	};
};

HmiProject.prototype.setWindow = function(pageId, props)
{
	var w = {};

	if (props.titleBar) { w.titleBar = true; }
	if (props.type != null && props.type !== 'replace') { w.type = props.type; }

	var dims = ['x', 'y', 'width', 'height'];

	for (var i = 0; i < dims.length; i++)
	{
		var v = parseInt(props[dims[i]], 10);

		if (!isNaN(v))
		{
			w[dims[i]] = v;
		}
	}

	for (var i = 0; i < HmiProject.WINDOW_SCRIPTS.length; i++)
	{
		var key = HmiProject.WINDOW_SCRIPTS[i];

		if (props[key] != null && props[key] !== '')
		{
			w[key] = '' + props[key];
		}
	}

	if (props.everyMs != null && props.everyMs !== '' &&
		('' + props.everyMs) !== HmiProject.DEFAULT_WINDOW_EVERY_MS)
	{
		w.everyMs = '' + props.everyMs;
	}

	// Values equal to the defaults are not stored, so a window the user only
	// looked at does not freeze today's resolution into the file.
	if (w.x === 0) { delete w.x; }
	if (w.y === 0) { delete w.y; }
	if (w.width === this.settings.width) { delete w.width; }
	if (w.height === this.settings.height) { delete w.height; }

	if (Object.keys(w).length === 0)
	{
		delete this.windows[pageId];
	}
	else
	{
		this.windows[pageId] = w;
	}
};

/** Drops the properties and startup entries of pages that no longer exist. */
HmiProject.prototype.prunePages = function(pageIds)
{
	var live = {};

	for (var i = 0; i < pageIds.length; i++)
	{
		live[pageIds[i]] = true;
	}

	for (var id in this.windows)
	{
		if (!live[id])
		{
			delete this.windows[id];
		}
	}

	var startup = [];

	for (var i = 0; i < this.settings.startup.length; i++)
	{
		if (live[this.settings.startup[i]])
		{
			startup.push(this.settings.startup[i]);
		}
	}

	this.settings.startup = startup;
};

// --------------------------------------------------------------------- tags

/** Tag names are matched case-insensitively, as InTouch does. */
HmiProject.prototype.getTag = function(name)
{
	return (name != null) ? this.tagIndex[name.toLowerCase()] : null;
};

HmiProject.prototype.reindex = function()
{
	this.tagIndex = {};

	for (var i = 0; i < this.tags.length; i++)
	{
		this.tagIndex[this.tags[i].name.toLowerCase()] = this.tags[i];
	}

	this.touch();
};

HmiProject.prototype.addTag = function(tag)
{
	if (this.getTag(tag.name) != null)
	{
		throw new Error('Duplicate tag name: ' + tag.name);
	}

	this.tags.push(tag);
	this.tagIndex[tag.name.toLowerCase()] = tag;
	this.touch();

	return tag;
};

HmiProject.prototype.removeTag = function(name)
{
	var tag = this.getTag(name);

	if (tag != null)
	{
		this.tags.splice(mxUtils.indexOf(this.tags, tag), 1);
		delete this.tagIndex[name.toLowerCase()];
		this.touch();
	}

	return tag;
};

/**
 * Creates a tag with the defaults its type implies.
 */
HmiProject.createTag = function(name, type)
{
	var tag = {name: name, type: type, comment: ''};

	if (HmiTypes.isAnalog(type))
	{
		tag.engUnits = '';
		tag.initial = 0;
		tag.minEU = 0;
		tag.maxEU = 100;
	}
	else if (HmiTypes.isDiscrete(type))
	{
		tag.initial = 0;
		tag.onMsg = 'On';
		tag.offMsg = 'Off';
	}
	else
	{
		tag.initial = '';
	}

	if (HmiTypes.isIO(type))
	{
		tag.device = '';
		tag.address = '';

		// Values arrive as the device holds them unless scaling is asked for;
		// the raw range is only used when it is.
		if (HmiTypes.isAnalog(type))
		{
			tag.scaled = false;
			tag.minRaw = 0;
			tag.maxRaw = 32767;
		}
	}

	return tag;
};

// ---------------------------------------------------------------- devices

/**
 * Protocols a device can speak, and the options each takes. The simulator is
 * handled inside the HMI; the others by the hmi-comms server.
 */
HmiProject.PROTOCOLS = [
	{value: 'simulator', label: 'Simulator', port: null, options: []},
	{value: 'logix', label: 'EtherNet/IP (ControlLogix, CompactLogix)', port: 44818,
		placeholder: 'Tag, Program:Main.Tag, Arr[3], Status.5',
		options: [
			{key: 'slot', label: 'Processor slot', type: 'int', def: 0},
			{key: 'micro800', label: 'Micro800', type: 'bool', def: false}]},
	{value: 'slc', label: 'SLC 500 / MicroLogix (PCCC)', port: 44818,
		placeholder: 'N7:0, B3:1/4, F8:2, T4:0.ACC, ST9:0',
		options: [
			{key: 'maxGapElements', label: 'Largest gap in a read', type: 'int', def: 118},
			{key: 'swapStringBytes', label: 'Swap string bytes', type: 'bool', def: true}]},
	{value: 'modbus', label: 'Modbus TCP', port: 502,
		placeholder: 'HR:0, HR:10:FLOAT, CO:5, HR:4.3',
		options: [
			{key: 'unitId', label: 'Unit id', type: 'int', def: 1},
			{key: 'byteOrder', label: 'Byte order', type: 'select', def: 'BE',
				choices: [{value: 'BE', label: 'ABCD (BE)'}, {value: 'MLE', label: 'CDAB (MLE)'},
					{value: 'MBE', label: 'BADC (MBE)'}, {value: 'LE', label: 'DCBA (LE)'}]},
			{key: 'maxGapRegisters', label: 'Largest gap in a read', type: 'int', def: 16}]}];

HmiProject.protocol = function(value)
{
	for (var i = 0; i < HmiProject.PROTOCOLS.length; i++)
	{
		if (HmiProject.PROTOCOLS[i].value === value)
		{
			return HmiProject.PROTOCOLS[i];
		}
	}

	return null;
};

HmiProject.createDevice = function(name, protocol)
{
	var def = HmiProject.protocol(protocol) || HmiProject.PROTOCOLS[0];
	var device = {name: name, protocol: def.value, host: '', port: def.port,
		timeoutMs: 3000, scanMs: 250, enabled: true, options: {}};

	for (var i = 0; i < def.options.length; i++)
	{
		device.options[def.options[i].key] = def.options[i].def;
	}

	return device;
};

/** Device names are matched without regard to case. */
HmiProject.prototype.getDevice = function(name)
{
	var lower = ('' + (name || '')).toLowerCase();

	for (var i = 0; i < this.devices.length; i++)
	{
		if (this.devices[i].name.toLowerCase() === lower)
		{
			return this.devices[i];
		}
	}

	return null;
};

/** Names of the tags that use a device. */
HmiProject.prototype.deviceUsers = function(name)
{
	var lower = ('' + name).toLowerCase();
	var res = [];

	for (var i = 0; i < this.tags.length; i++)
	{
		if (this.tags[i].device != null && this.tags[i].device.toLowerCase() === lower)
		{
			res.push(this.tags[i].name);
		}
	}

	return res;
};

/** Renames a device and every tag's reference to it. */
HmiProject.prototype.renameDevice = function(oldName, newName)
{
	var device = this.getDevice(oldName);

	if (device == null)
	{
		return;
	}

	var lower = oldName.toLowerCase();

	for (var i = 0; i < this.tags.length; i++)
	{
		if (this.tags[i].device != null && this.tags[i].device.toLowerCase() === lower)
		{
			this.tags[i].device = newName;
		}
	}

	device.name = newName;
	this.touch();
};

HmiProject.prototype.removeDevice = function(name)
{
	var device = this.getDevice(name);

	if (device != null)
	{
		this.devices.splice(mxUtils.indexOf(this.devices, device), 1);
		this.touch();
	}

	return device;
};

/** The device an I/O tag reads through, or null. */
HmiProject.prototype.deviceOf = function(tag)
{
	return (tag != null && HmiTypes.isIO(tag.type)) ? this.getDevice(tag.device) : null;
};

// -------------------------------------------------------------- cell links

/**
 * Reads a cell's animation links.
 *
 * @returns {Object} link key -> config. Always an object, never null.
 */
HmiProject.getCellLinks = function(graph, cell)
{
	return HmiLog.guard('getCellLinks', function()
	{
		var raw = graph.getAttributeForCell(cell, HmiProject.CELL_ATTRIBUTE, null);

		if (raw == null || raw === '')
		{
			return {};
		}

		var data = JSON.parse(raw);

		return (data != null && data.links != null) ? data.links : {};
	}, {});
};

/**
 * Writes a cell's animation links as one attribute, which is one undoable
 * edit. Removing the last link removes the attribute entirely so that cells
 * without animation stay clean in the saved XML.
 */
HmiProject.setCellLinks = function(graph, cell, links)
{
	var empty = true;

	for (var key in links)
	{
		empty = false;
		break;
	}

	var value = (empty) ? null :
		JSON.stringify({v: HmiProject.FORMAT_VERSION, links: links});

	var model = graph.getModel();

	model.beginUpdate();

	try
	{
		HmiProject.ensureUserObject(graph, cell);
		graph.setAttributeForCell(cell, HmiProject.CELL_ATTRIBUTE, value);
	}
	finally
	{
		model.endUpdate();
	}
};

/**
 * Promotes a cell whose value is a plain string (or null) to a <UserObject>
 * node, so that attributes can be set on it.
 *
 * setAttributeForCell does this itself in current upstream, but it is cheap
 * insurance against that changing, and it makes the dependency explicit.
 */
HmiProject.ensureUserObject = function(graph, cell)
{
	if (cell.value == null || typeof cell.value !== 'object')
	{
		var doc = mxUtils.createXmlDocument();
		var obj = doc.createElement('UserObject');
		obj.setAttribute('label', (cell.value != null) ? cell.value : '');
		graph.getModel().setValue(cell, obj);
	}
};

// ----------------------------------------------------------- serialization

HmiProject.prototype.toXml = function(doc)
{
	var root = doc.createElement('hmiProject');
	root.setAttribute('version', HmiProject.FORMAT_VERSION);

	var devices = doc.createElement('devices');

	for (var i = 0; i < this.devices.length; i++)
	{
		devices.appendChild(HmiProject.deviceToXml(doc, this.devices[i]));
	}

	root.appendChild(devices);

	var tags = doc.createElement('tags');

	for (var i = 0; i < this.tags.length; i++)
	{
		tags.appendChild(HmiProject.tagToXml(doc, this.tags[i]));
	}

	root.appendChild(tags);

	var settings = doc.createElement('settings');
	settings.setAttribute('width', this.settings.width);
	settings.setAttribute('height', this.settings.height);

	for (var i = 0; i < this.settings.startup.length; i++)
	{
		var node = doc.createElement('startup');
		node.setAttribute('page', this.settings.startup[i]);
		settings.appendChild(node);
	}

	root.appendChild(settings);

	var windows = doc.createElement('windows');
	var ids = Object.keys(this.windows).sort();

	for (var i = 0; i < ids.length; i++)
	{
		var w = this.windows[ids[i]];
		var node = doc.createElement('window');
		node.setAttribute('page', ids[i]);

		var keys = ['titleBar', 'type', 'x', 'y', 'width', 'height', 'everyMs'];

		for (var j = 0; j < keys.length; j++)
		{
			if (w[keys[j]] != null)
			{
				node.setAttribute(keys[j], (w[keys[j]] === true) ?
					'1' : '' + w[keys[j]]);
			}
		}

		for (var j = 0; j < HmiProject.WINDOW_SCRIPTS.length; j++)
		{
			var key = HmiProject.WINDOW_SCRIPTS[j];

			if (w[key] != null && w[key] !== '')
			{
				var script = doc.createElement(key);
				script.appendChild(doc.createTextNode(w[key]));
				node.appendChild(script);
			}
		}

		windows.appendChild(node);
	}

	root.appendChild(windows);

	return root;
};

/**
 * Options are written as attributes, in the order the protocol declares
 * them, so a round trip is byte-stable.
 */
HmiProject.deviceToXml = function(doc, d)
{
	var node = doc.createElement('device');
	node.setAttribute('name', d.name);
	node.setAttribute('protocol', d.protocol);

	if (d.host) { node.setAttribute('host', d.host); }
	if (d.port != null && d.port !== '') { node.setAttribute('port', '' + d.port); }

	node.setAttribute('timeoutMs', '' + (d.timeoutMs || 3000));
	node.setAttribute('scanMs', '' + (d.scanMs || 250));

	if (d.enabled === false) { node.setAttribute('enabled', '0'); }

	var def = HmiProject.protocol(d.protocol);

	if (def != null)
	{
		for (var i = 0; i < def.options.length; i++)
		{
			var v = d.options != null ? d.options[def.options[i].key] : null;

			if (v != null && v !== '')
			{
				node.setAttribute(def.options[i].key, (v === true) ? '1' : (v === false) ? '0' : '' + v);
			}
		}
	}

	return node;
};

HmiProject.deviceFromXml = function(n)
{
	var d = HmiProject.createDevice(n.getAttribute('name') || '', n.getAttribute('protocol'));
	d.host = n.getAttribute('host') || '';

	var port = parseInt(n.getAttribute('port'), 10);
	d.port = isNaN(port) ? d.port : port;
	d.timeoutMs = parseInt(n.getAttribute('timeoutMs'), 10) || 3000;
	d.scanMs = parseInt(n.getAttribute('scanMs'), 10) || 250;
	d.enabled = n.getAttribute('enabled') !== '0';

	var def = HmiProject.protocol(d.protocol);

	if (def != null)
	{
		for (var i = 0; i < def.options.length; i++)
		{
			var o = def.options[i];
			var v = n.getAttribute(o.key);

			if (v != null)
			{
				d.options[o.key] = (o.type === 'bool') ? (v === '1' || v === 'true') :
					(o.type === 'int') ? parseInt(v, 10) : v;
			}
		}
	}

	return d;
};

HmiProject.tagToXml = function(doc, tag)
{
	var node = doc.createElement('tag');

	// Written in a fixed order so that a round trip is byte-stable and files
	// diff cleanly in git.
	var scalars = ['name', 'type', 'comment', 'engUnits', 'initial',
		'minEU', 'maxEU', 'scaled', 'minRaw', 'maxRaw', 'device', 'address',
		'onMsg', 'offMsg', 'logged', 'retentive'];

	for (var i = 0; i < scalars.length; i++)
	{
		var k = scalars[i];

		if (tag[k] != null && tag[k] !== '')
		{
			node.setAttribute(k, '' + tag[k]);
		}
	}

	if (tag.alarms != null)
	{
		var al = doc.createElement('alarms');

		for (var k in tag.alarms)
		{
			if (tag.alarms[k] != null && tag.alarms[k] !== '')
			{
				al.setAttribute(k, '' + tag.alarms[k]);
			}
		}

		node.appendChild(al);
	}

	if (tag.sim != null)
	{
		var sim = doc.createElement('sim');

		for (var k in tag.sim)
		{
			if (tag.sim[k] != null && tag.sim[k] !== '')
			{
				sim.setAttribute(k, '' + tag.sim[k]);
			}
		}

		node.appendChild(sim);
	}

	return node;
};

HmiProject.fromXml = function(node)
{
	var project = new HmiProject();

	if (node == null)
	{
		return project;
	}

	var devices = node.getElementsByTagName('device');

	for (var i = 0; i < devices.length; i++)
	{
		project.devices.push(HmiProject.deviceFromXml(devices[i]));
	}

	var tags = node.getElementsByTagName('tag');

	for (var i = 0; i < tags.length; i++)
	{
		project.tags.push(HmiProject.tagFromXml(tags[i]));
	}

	var settings = node.getElementsByTagName('settings');

	if (settings.length > 0)
	{
		var w = parseInt(settings[0].getAttribute('width'), 10);
		var h = parseInt(settings[0].getAttribute('height'), 10);

		if (w > 0) { project.settings.width = w; }
		if (h > 0) { project.settings.height = h; }

		var startup = settings[0].getElementsByTagName('startup');

		for (var i = 0; i < startup.length; i++)
		{
			var id = startup[i].getAttribute('page');

			if (id)
			{
				project.settings.startup.push(id);
			}
		}
	}

	var windows = node.getElementsByTagName('window');

	for (var i = 0; i < windows.length; i++)
	{
		var n = windows[i];
		var id = n.getAttribute('page');

		if (!id)
		{
			continue;
		}

		var w = {};

		if (n.getAttribute('titleBar') === '1') { w.titleBar = true; }
		if (n.getAttribute('type')) { w.type = n.getAttribute('type'); }
		if (n.getAttribute('everyMs')) { w.everyMs = n.getAttribute('everyMs'); }

		for (var j = 0; j < HmiProject.WINDOW_SCRIPTS.length; j++)
		{
			var key = HmiProject.WINDOW_SCRIPTS[j];
			var list = n.getElementsByTagName(key);

			if (list.length > 0 && mxUtils.getTextContent(list[0]) !== '')
			{
				w[key] = mxUtils.getTextContent(list[0]);
			}
		}

		var dims = ['x', 'y', 'width', 'height'];

		for (var j = 0; j < dims.length; j++)
		{
			var v = parseInt(n.getAttribute(dims[j]), 10);

			if (!isNaN(v))
			{
				w[dims[j]] = v;
			}
		}

		project.windows[id] = w;
	}

	project.reindex();

	return project;
};

HmiProject.tagFromXml = function(node)
{
	var tag = {name: node.getAttribute('name'), type: node.getAttribute('type')};

	var strings = ['comment', 'engUnits', 'device', 'address', 'onMsg', 'offMsg'];

	for (var i = 0; i < strings.length; i++)
	{
		var v = node.getAttribute(strings[i]);

		if (v != null)
		{
			tag[strings[i]] = v;
		}
	}

	var scaled = node.getAttribute('scaled');

	if (scaled != null)
	{
		tag.scaled = (scaled === 'true' || scaled === '1');
	}

	var numbers = ['minEU', 'maxEU', 'minRaw', 'maxRaw'];

	for (var i = 0; i < numbers.length; i++)
	{
		var v = node.getAttribute(numbers[i]);

		if (v != null)
		{
			tag[numbers[i]] = parseFloat(v);
		}
	}

	var initial = node.getAttribute('initial');

	if (initial != null)
	{
		tag.initial = (HmiTypes.isMessage(tag.type)) ? initial : parseFloat(initial);
	}

	var flags = ['logged', 'retentive'];

	for (var i = 0; i < flags.length; i++)
	{
		var v = node.getAttribute(flags[i]);

		if (v != null)
		{
			tag[flags[i]] = (v === '1' || v === 'true');
		}
	}

	tag.alarms = HmiProject.attrsOf(node, 'alarms', true);
	tag.sim = HmiProject.attrsOf(node, 'sim', false);

	return tag;
};

/**
 * Collects the attributes of the first child element with the given name.
 * Returns null when absent so that an unused section is not written back.
 */
HmiProject.attrsOf = function(node, name, numeric)
{
	var list = node.getElementsByTagName(name);

	if (list.length === 0)
	{
		return null;
	}

	var res = {};
	var attrs = list[0].attributes;

	for (var i = 0; i < attrs.length; i++)
	{
		var v = attrs[i].value;
		res[attrs[i].name] = (numeric) ? parseFloat(v) : v;
	}

	return res;
};
