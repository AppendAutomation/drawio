/**
 * The HMI project model: access names, the tag dictionary, the application
 * settings and the display properties of each window (page).
 *
 * Serialization lives entirely behind toXml/fromXml so that if the
 * <hmiProject> child of <mxfile> ever proves unable to survive a save path,
 * switching to the hidden-page fallback is a change to this file alone.
 */
HmiProject = function()
{
	this.accessNames = [];
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

	return this.tags.length === 0 && this.accessNames.length === 0 &&
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
		height: (w.height != null) ? w.height : this.settings.height
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
		tag.access = '';
		tag.item = '';

		if (HmiTypes.isAnalog(type))
		{
			tag.minRaw = 0;
			tag.maxRaw = 32767;
		}
	}

	return tag;
};

// ------------------------------------------------------------ access names

HmiProject.prototype.getAccessName = function(id)
{
	for (var i = 0; i < this.accessNames.length; i++)
	{
		if (this.accessNames[i].id === id)
		{
			return this.accessNames[i];
		}
	}

	return null;
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

	var names = doc.createElement('accessNames');

	for (var i = 0; i < this.accessNames.length; i++)
	{
		var a = this.accessNames[i];
		var node = doc.createElement('accessName');
		node.setAttribute('id', a.id);
		node.setAttribute('driver', a.driver);

		if (a.node != null && a.node !== '') { node.setAttribute('node', a.node); }
		if (a.topic != null && a.topic !== '') { node.setAttribute('topic', a.topic); }

		node.setAttribute('rateMs', a.rateMs != null ? a.rateMs : 250);
		names.appendChild(node);
	}

	root.appendChild(names);

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

		var keys = ['titleBar', 'type', 'x', 'y', 'width', 'height'];

		for (var j = 0; j < keys.length; j++)
		{
			if (w[keys[j]] != null)
			{
				node.setAttribute(keys[j], (w[keys[j]] === true) ?
					'1' : '' + w[keys[j]]);
			}
		}

		windows.appendChild(node);
	}

	root.appendChild(windows);

	return root;
};

HmiProject.tagToXml = function(doc, tag)
{
	var node = doc.createElement('tag');

	// Written in a fixed order so that a round trip is byte-stable and files
	// diff cleanly in git.
	var scalars = ['name', 'type', 'comment', 'engUnits', 'initial',
		'minEU', 'maxEU', 'minRaw', 'maxRaw', 'access', 'item',
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

	var names = node.getElementsByTagName('accessName');

	for (var i = 0; i < names.length; i++)
	{
		var n = names[i];
		project.accessNames.push({
			id: n.getAttribute('id'),
			driver: n.getAttribute('driver') || 'simulator',
			node: n.getAttribute('node') || '',
			topic: n.getAttribute('topic') || '',
			rateMs: parseInt(n.getAttribute('rateMs') || '250', 10)
		});
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

	var strings = ['comment', 'engUnits', 'access', 'item', 'onMsg', 'offMsg'];

	for (var i = 0; i < strings.length; i++)
	{
		var v = node.getAttribute(strings[i]);

		if (v != null)
		{
			tag[strings[i]] = v;
		}
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
