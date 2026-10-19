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

	// Users: {name, level, salt, hash, iterations} (see HmiSecurity)
	this.users = [];

	// Recipe books (see HmiRecipes): {name, uploadDownload, items: [{tag,
	// ioTag}], recipes: {name: {tag: value}}}; recipes are the starting ones
	this.recipeBooks = [];

	// QuickFunctions (see HmiQuickFn): {name, args: [{name, type}], body},
	// user-defined functions callable from scripts and expressions
	this.quickFunctions = [];

	// SQL database access (see HmiSql). Data sources are the databases the
	// application can open, bind lists pair a tag with a column, table
	// templates shape a table it creates, and queries are named statements.
	this.dataSources = [];
	this.bindLists = [];
	this.tableTemplates = [];
	this.queries = [];

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
		this.settings.startup.length === 0 && this.settings.touchFill === d.touchFill &&
		JSON.stringify(this.settings.runtime) === JSON.stringify(d.runtime) &&
		JSON.stringify(this.settings.publish) === JSON.stringify(d.publish) &&
		JSON.stringify(this.settings.security) === JSON.stringify(d.security) &&
		JSON.stringify(this.settings.scripts) === JSON.stringify(d.scripts) &&
		this.users.length === 0 && this.recipeBooks.length === 0 &&
		this.quickFunctions.length === 0 &&
		this.dataSources.length === 0 && this.bindLists.length === 0 &&
		this.tableTemplates.length === 0 && this.queries.length === 0 &&
		Object.keys(this.windows).length === 0;
};

// ------------------------------------------------------ application settings

/** Target screen resolutions offered in Application Settings. */
HmiProject.RESOLUTIONS = [
	[640, 480], [800, 480], [800, 600], [1024, 600], [1024, 768],
	[1280, 720], [1280, 800], [1280, 1024], [1366, 768], [1440, 900],
	[1600, 900], [1680, 1050], [1920, 1080], [1920, 1200]];

/**
 * touchFill is the touch background color: what an object carrying a touch
 * animation is drawn in while the operator holds it down. It is one color for
 * the whole application, since the feedback a touch screen gives should not
 * change from one button to the next, and it is unset by default -- then
 * nothing is drawn differently, which is how every project built before it
 * behaved.
 */
HmiProject.defaultSettings = function()
{
	return {width: 1024, height: 768, startup: [], touchFill: '',
		runtime: HmiProject.defaultRuntime(), publish: {}, security: {autoLogoutMin: 0},
		scripts: HmiProject.defaultAppScripts()};
};

/**
 * Application scripts: On start runs once when the application starts, before
 * its first window opens; While running every everyMs while it runs; On
 * shutdown once as it stops, after its windows have closed.
 */
HmiProject.APP_SCRIPTS = ['onStart', 'whileRunning', 'onShutdown'];

HmiProject.DEFAULT_APP_EVERY_MS = '1000';

HmiProject.defaultAppScripts = function()
{
	return {onStart: '', whileRunning: '', onShutdown: '', everyMs: HmiProject.DEFAULT_APP_EVERY_MS};
};

/**
 * How a published package runs on the target PC. The exit password is kept
 * only as a salted SHA-256 hash (hex of SHA-256(salt + password)), which the
 * package checks in its main process.
 */
HmiProject.WINDOW_MODES = ['kiosk', 'fullscreen', 'window'];
HmiProject.EXIT_MODES = ['shortcut', 'password', 'never'];

HmiProject.defaultRuntime = function()
{
	return {windowMode: 'kiosk', exit: 'shortcut', salt: '', hash: ''};
};

/** The options HMI > Publish remembers, as the attributes they are saved as. */
HmiProject.PUBLISH_FIELDS = ['productName', 'version', 'publisher', 'icon',
	'scope', 'desktop', 'autostart', 'compression', 'output'];

/** Hex SHA-256 of salt + password, resolved asynchronously (Web Crypto). */
HmiProject.hashPassword = function(salt, password)
{
	var bytes = new TextEncoder().encode(salt + password);

	return window.crypto.subtle.digest('SHA-256', bytes).then(function(buf)
	{
		return Array.prototype.map.call(new Uint8Array(buf), function(b)
		{
			return ('0' + b.toString(16)).slice(-2);
		}).join('');
	});
};

HmiProject.randomSalt = function()
{
	var bytes = new Uint8Array(16);
	window.crypto.getRandomValues(bytes);

	return Array.prototype.map.call(bytes, function(b)
	{
		return ('0' + b.toString(16)).slice(-2);
	}).join('');
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

/** The title's font size at scale 1, when the window sets none. */
HmiProject.TITLE_FONT_SIZE = 13;

/**
 * What css/hmi.css draws a title bar in. A window that sets no color of its
 * own gets no inline style at all, so these are only what the Window
 * Properties swatches and its preview show meanwhile -- they and the style
 * sheet have to be changed together.
 */
HmiProject.TITLE_BAR_FILL = '#1f4e8c';
HmiProject.TITLE_BAR_COLOR = '#ffffff';

/** What a title bar height and font size are allowed to be. */
HmiProject.MIN_TITLE_BAR_HEIGHT = 8;
HmiProject.MAX_TITLE_BAR_HEIGHT = 400;
HmiProject.MIN_TITLE_FONT_SIZE = 6;
HmiProject.MAX_TITLE_FONT_SIZE = 72;

/** Window scripts, stored as child elements so multi-line text stays legible. */
HmiProject.WINDOW_SCRIPTS = ['onShow', 'whileShowing', 'onHide'];

HmiProject.DEFAULT_WINDOW_EVERY_MS = '1000';

/**
 * A script element's text. A file saved pretty-printed puts the text on a
 * line of its own, indented, which is not part of the script.
 */
HmiProject.scriptText = function(node)
{
	return mxUtils.getTextContent(node).replace(/^\r?\n[ \t]*/, '').replace(/\r?\n[ \t]*$/, '');
};

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
		movable: w.movable === true,
		titleHeight: (w.titleHeight != null) ? w.titleHeight :
			HmiProject.TITLE_BAR_HEIGHT,
		titleFont: w.titleFont || '',
		titleFontSize: (w.titleFontSize != null) ? w.titleFontSize : '',
		titleFill: w.titleFill || '',
		titleColor: w.titleColor || '',
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
	if (props.movable) { w.movable = true; }
	if (props.type != null && props.type !== 'replace') { w.type = props.type; }

	// The title bar's own look. An unset color or font is left unset, so
	// css/hmi.css keeps its say and a window drawn before these settings
	// existed looks exactly as it did. They are kept while the bar is off,
	// so turning it back on brings them with it.
	var titleStrings = ['titleFont', 'titleFill', 'titleColor'];

	for (var i = 0; i < titleStrings.length; i++)
	{
		var text = props[titleStrings[i]];

		if (text != null && ('' + text).trim() !== '')
		{
			w[titleStrings[i]] = ('' + text).trim();
		}
	}

	var height = parseInt(props.titleHeight, 10);

	if (!isNaN(height) && height !== HmiProject.TITLE_BAR_HEIGHT)
	{
		w.titleHeight = height;
	}

	var fontSize = parseInt(props.titleFontSize, 10);

	if (!isNaN(fontSize))
	{
		w.titleFontSize = fontSize;
	}

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

	if (HmiTypes.systemTag(tag.name) != null)
	{
		throw new Error('"' + tag.name + '" is a system tag name');
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

	// No value, range or device of its own: those are the linked tag's
	if (HmiTypes.isIndirect(type))
	{
		return tag;
	}

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

	// An unset touch color is not written, so a file round trips unchanged.
	if (this.settings.touchFill)
	{
		settings.setAttribute('touchFill', this.settings.touchFill);
	}

	for (var i = 0; i < this.settings.startup.length; i++)
	{
		var node = doc.createElement('startup');
		node.setAttribute('page', this.settings.startup[i]);
		settings.appendChild(node);
	}

	var rt = this.settings.runtime;
	var drt = HmiProject.defaultRuntime();

	if (JSON.stringify(rt) !== JSON.stringify(drt))
	{
		var node = doc.createElement('runtime');
		node.setAttribute('windowMode', rt.windowMode);
		node.setAttribute('exit', rt.exit);

		if (rt.hash)
		{
			node.setAttribute('salt', rt.salt);
			node.setAttribute('hash', rt.hash);
		}

		settings.appendChild(node);
	}

	var pub = this.settings.publish;

	if (Object.keys(pub).length > 0)
	{
		var node = doc.createElement('publish');

		for (var i = 0; i < HmiProject.PUBLISH_FIELDS.length; i++)
		{
			var key = HmiProject.PUBLISH_FIELDS[i];

			if (pub[key] != null)
			{
				node.setAttribute(key, String(pub[key]));
			}
		}

		settings.appendChild(node);
	}

	var scripts = this.settings.scripts;

	if (JSON.stringify(scripts) !== JSON.stringify(HmiProject.defaultAppScripts()))
	{
		var node = doc.createElement('appScripts');

		if (scripts.everyMs !== HmiProject.DEFAULT_APP_EVERY_MS)
		{
			node.setAttribute('everyMs', '' + scripts.everyMs);
		}

		for (var i = 0; i < HmiProject.APP_SCRIPTS.length; i++)
		{
			var key = HmiProject.APP_SCRIPTS[i];

			if (scripts[key] !== '')
			{
				var script = doc.createElement(key);
				script.appendChild(doc.createTextNode(scripts[key]));
				node.appendChild(script);
			}
		}

		settings.appendChild(node);
	}

	root.appendChild(settings);

	if (this.settings.security.autoLogoutMin > 0)
	{
		var sec = doc.createElement('security');
		sec.setAttribute('autoLogoutMin', '' + this.settings.security.autoLogoutMin);
		settings.appendChild(sec);
	}

	if (this.users.length > 0)
	{
		var users = doc.createElement('users');

		for (var i = 0; i < this.users.length; i++)
		{
			var u = this.users[i];
			var un = doc.createElement('user');
			un.setAttribute('name', u.name);
			un.setAttribute('level', '' + u.level);
			un.setAttribute('salt', u.salt || '');
			un.setAttribute('hash', u.hash || '');
			un.setAttribute('iterations', '' + (u.iterations || HmiSecurity.ITERATIONS));
			users.appendChild(un);
		}

		root.appendChild(users);
	}

	// Element names unlike any other project element: fromXml finds those by
	// name anywhere in the project
	if (this.recipeBooks.length > 0)
	{
		var books = doc.createElement('recipeBooks');

		for (var i = 0; i < this.recipeBooks.length; i++)
		{
			var b = this.recipeBooks[i];
			var bn = doc.createElement('recipeBook');
			bn.setAttribute('name', b.name);
			bn.setAttribute('uploadDownload', (b.uploadDownload) ? '1' : '0');

			for (var j = 0; j < b.items.length; j++)
			{
				var item = doc.createElement('recipeItem');
				item.setAttribute('tag', b.items[j].tag || '');

				if (b.items[j].ioTag)
				{
					item.setAttribute('ioTag', b.items[j].ioTag);
				}

				bn.appendChild(item);
			}

			var names = Object.keys(b.recipes || {});

			for (var j = 0; j < names.length; j++)
			{
				var data = doc.createElement('recipeData');
				data.setAttribute('name', names[j]);
				var values = b.recipes[names[j]];

				for (var tag in values)
				{
					var vn = doc.createElement('recipeValue');
					vn.setAttribute('tag', tag);
					vn.setAttribute('value', (values[tag] == null) ? '' : '' + values[tag]);

					if (typeof values[tag] === 'number')
					{
						vn.setAttribute('number', '1');
					}

					data.appendChild(vn);
				}

				bn.appendChild(data);
			}

			books.appendChild(bn);
		}

		root.appendChild(books);
	}

	// Element names unlike any other project element, as the recipe books are
	if (this.quickFunctions.length > 0)
	{
		var fns = doc.createElement('quickFunctions');

		for (var i = 0; i < this.quickFunctions.length; i++)
		{
			var fn = this.quickFunctions[i];
			var fnNode = doc.createElement('quickFunction');
			fnNode.setAttribute('name', fn.name);

			for (var a = 0; fn.args != null && a < fn.args.length; a++)
			{
				var arg = doc.createElement('quickArg');
				arg.setAttribute('name', fn.args[a].name);
				arg.setAttribute('type', fn.args[a].type);
				fnNode.appendChild(arg);
			}

			// An empty body writes no element at all, so that a pretty
			// printed file still round trips byte for byte.
			if (fn.body)
			{
				var body = doc.createElement('quickBody');
				body.appendChild(doc.createTextNode(fn.body));
				fnNode.appendChild(body);
			}

			fns.appendChild(fnNode);
		}

		root.appendChild(fns);
	}

	// SQL database access (HmiSql.js). Element names unlike any other
	// project element, as the recipe books and QuickFunctions are.
	if (this.dataSources.length > 0)
	{
		var sources = doc.createElement('dataSources');

		for (var i = 0; i < this.dataSources.length; i++)
		{
			var s = this.dataSources[i];
			var sn = doc.createElement('dataSource');
			sn.setAttribute('name', s.name);
			sn.setAttribute('provider', s.provider || 'mssql');

			if (s.provider === 'sqlite')
			{
				sn.setAttribute('file', s.file || '');

				if (HmiSql.normalizeFolder(s.folder) === 'documents')
				{
					sn.setAttribute('folder', 'documents');
				}
			}
			else
			{
				sn.setAttribute('host', s.host || '');

				var plain = ['port', 'database', 'user'];

				for (var p = 0; p < plain.length; p++)
				{
					if (s[plain[p]] !== '' && s[plain[p]] != null)
					{
						sn.setAttribute(plain[p], '' + s[plain[p]]);
					}
				}

				// Wrapped, which keeps it out of plain sight and no more;
				// src/main/sql/Secret.js says as much
				if (s.password)
				{
					sn.setAttribute('password', s.password);
				}

				var o = s.options || {};

				if (o.encrypt === true)
				{
					sn.setAttribute('encrypt', '1');
				}

				if (o.trustServerCertificate === false)
				{
					sn.setAttribute('trustServerCertificate', '0');
				}

				if (o.legacyTls === true)
				{
					sn.setAttribute('legacyTls', '1');
				}

				if (o.instanceName)
				{
					sn.setAttribute('instanceName', o.instanceName);
				}
			}

			if (s.timeoutMs !== '' && s.timeoutMs != null)
			{
				sn.setAttribute('timeoutMs', '' + s.timeoutMs);
			}

			sources.appendChild(sn);
		}

		root.appendChild(sources);
	}

	if (this.bindLists.length > 0)
	{
		var lists = doc.createElement('bindLists');

		for (var i = 0; i < this.bindLists.length; i++)
		{
			var bl = this.bindLists[i];
			var bln = doc.createElement('bindList');
			bln.setAttribute('name', bl.name);

			for (var j = 0; bl.items != null && j < bl.items.length; j++)
			{
				var it = bl.items[j];
				var itn = doc.createElement('bindItem');
				itn.setAttribute('tag', it.tag || '');
				itn.setAttribute('column', it.column || '');

				if (it.field)
				{
					itn.setAttribute('field', it.field);
				}

				if (it.delim)
				{
					itn.setAttribute('delim', it.delim);
				}

				bln.appendChild(itn);
			}

			lists.appendChild(bln);
		}

		root.appendChild(lists);
	}

	if (this.tableTemplates.length > 0)
	{
		var templates = doc.createElement('tableTemplates');

		for (var i = 0; i < this.tableTemplates.length; i++)
		{
			var t = this.tableTemplates[i];
			var tn = doc.createElement('tableTemplate');
			tn.setAttribute('name', t.name);

			for (var j = 0; t.columns != null && j < t.columns.length; j++)
			{
				var c = t.columns[j];
				var cn = doc.createElement('templateColumn');
				cn.setAttribute('name', c.name || '');
				cn.setAttribute('type', c.type || 'text');

				if (c.length !== '' && c.length != null)
				{
					cn.setAttribute('length', '' + c.length);
				}

				if (c.scale !== '' && c.scale != null)
				{
					cn.setAttribute('scale', '' + c.scale);
				}

				if (c.index && c.index !== 'none')
				{
					cn.setAttribute('index', c.index);
				}

				if (c.allowNull === false)
				{
					cn.setAttribute('allowNull', '0');
				}

				tn.appendChild(cn);
			}

			templates.appendChild(tn);
		}

		root.appendChild(templates);
	}

	if (this.queries.length > 0)
	{
		var queries = doc.createElement('queries');

		for (var i = 0; i < this.queries.length; i++)
		{
			var q = this.queries[i];
			var qn = doc.createElement('query');
			qn.setAttribute('name', q.name);

			// As a QuickFunction body: no element at all when there is no
			// statement, so a pretty printed file still round trips
			if (q.sql)
			{
				var sqlNode = doc.createElement('querySql');
				sqlNode.appendChild(doc.createTextNode(q.sql));
				qn.appendChild(sqlNode);
			}

			queries.appendChild(qn);
		}

		root.appendChild(queries);
	}

	var windows = doc.createElement('windows');
	var ids = Object.keys(this.windows).sort();

	for (var i = 0; i < ids.length; i++)
	{
		var w = this.windows[ids[i]];
		var node = doc.createElement('window');
		node.setAttribute('page', ids[i]);

		var keys = ['titleBar', 'movable', 'type', 'x', 'y', 'width', 'height',
			'titleHeight', 'titleFont', 'titleFontSize', 'titleFill', 'titleColor',
			'everyMs'];

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

		project.settings.touchFill = settings[0].getAttribute('touchFill') || '';

		var startup = settings[0].getElementsByTagName('startup');

		for (var i = 0; i < startup.length; i++)
		{
			var id = startup[i].getAttribute('page');

			if (id)
			{
				project.settings.startup.push(id);
			}
		}

		var runtime = settings[0].getElementsByTagName('runtime');

		if (runtime.length > 0)
		{
			var rt = project.settings.runtime;
			var mode = runtime[0].getAttribute('windowMode');
			var exit = runtime[0].getAttribute('exit');

			if (mxUtils.indexOf(HmiProject.WINDOW_MODES, mode) >= 0) { rt.windowMode = mode; }
			if (mxUtils.indexOf(HmiProject.EXIT_MODES, exit) >= 0) { rt.exit = exit; }

			rt.salt = runtime[0].getAttribute('salt') || '';
			rt.hash = runtime[0].getAttribute('hash') || '';
		}

		var publish = settings[0].getElementsByTagName('publish');

		if (publish.length > 0)
		{
			for (var i = 0; i < HmiProject.PUBLISH_FIELDS.length; i++)
			{
				var key = HmiProject.PUBLISH_FIELDS[i];
				var v = publish[0].getAttribute(key);

				if (v != null)
				{
					project.settings.publish[key] = (key === 'desktop' ||
						key === 'autostart') ? v === 'true' : v;
				}
			}
		}

		var appScripts = settings[0].getElementsByTagName('appScripts');

		if (appScripts.length > 0)
		{
			var scripts = project.settings.scripts;
			var every = appScripts[0].getAttribute('everyMs');

			if (every)
			{
				scripts.everyMs = every;
			}

			for (var i = 0; i < HmiProject.APP_SCRIPTS.length; i++)
			{
				var list = appScripts[0].getElementsByTagName(HmiProject.APP_SCRIPTS[i]);

				if (list.length > 0)
				{
					scripts[HmiProject.APP_SCRIPTS[i]] = HmiProject.scriptText(list[0]);
				}
			}
		}
	}

	var security = node.getElementsByTagName('security');

	if (security.length > 0)
	{
		var min = parseFloat(security[0].getAttribute('autoLogoutMin'));
		project.settings.security.autoLogoutMin = (min > 0) ? min : 0;
	}

	var userNodes = node.getElementsByTagName('user');

	for (var i = 0; i < userNodes.length; i++)
	{
		var un = userNodes[i];
		var level = parseInt(un.getAttribute('level'), 10);

		project.users.push({name: un.getAttribute('name') || '',
			level: isNaN(level) ? 0 : level,
			salt: un.getAttribute('salt') || '', hash: un.getAttribute('hash') || '',
			iterations: parseInt(un.getAttribute('iterations'), 10) || HmiSecurity.ITERATIONS});
	}

	var bookNodes = node.getElementsByTagName('recipeBook');

	for (var i = 0; i < bookNodes.length; i++)
	{
		var bn = bookNodes[i];
		var book = {name: bn.getAttribute('name') || '', uploadDownload: bn.getAttribute('uploadDownload') === '1',
			items: [], recipes: {}};
		var itemNodes = bn.getElementsByTagName('recipeItem');

		for (var j = 0; j < itemNodes.length; j++)
		{
			book.items.push({tag: itemNodes[j].getAttribute('tag') || '', ioTag: itemNodes[j].getAttribute('ioTag') || ''});
		}

		var dataNodes = bn.getElementsByTagName('recipeData');

		for (var j = 0; j < dataNodes.length; j++)
		{
			var values = {};
			var valueNodes = dataNodes[j].getElementsByTagName('recipeValue');

			for (var k = 0; k < valueNodes.length; k++)
			{
				var raw = valueNodes[k].getAttribute('value');
				values[valueNodes[k].getAttribute('tag') || ''] = (valueNodes[k].getAttribute('number') === '1') ?
					parseFloat(raw) : raw;
			}

			book.recipes[dataNodes[j].getAttribute('name') || ''] = values;
		}

		project.recipeBooks.push(book);
	}

	var fnNodes = node.getElementsByTagName('quickFunction');

	for (var i = 0; i < fnNodes.length; i++)
	{
		var fnNode = fnNodes[i];
		var fn = {name: fnNode.getAttribute('name') || '', args: [], body: ''};
		var argNodes = fnNode.getElementsByTagName('quickArg');

		for (var j = 0; j < argNodes.length; j++)
		{
			fn.args.push({name: argNodes[j].getAttribute('name') || '',
				type: HmiQuickFn.normalizeType(argNodes[j].getAttribute('type'))});
		}

		var bodyNodes = fnNode.getElementsByTagName('quickBody');

		if (bodyNodes.length > 0)
		{
			fn.body = HmiProject.scriptText(bodyNodes[0]);
		}

		project.quickFunctions.push(fn);
	}

	// SQL database access (HmiSql.js). Names are trimmed on the way in: a
	// script names one of these as text, so a stray space in a hand-edited
	// file would leave a name nothing could match.
	var sourceNodes = node.getElementsByTagName('dataSource');

	for (var i = 0; i < sourceNodes.length; i++)
	{
		var sn = sourceNodes[i];
		var source = HmiSql.newDataSource((sn.getAttribute('name') || '').trim());
		var found = HmiSql.provider(sn.getAttribute('provider'));
		source.provider = (found != null) ? found.value : 'mssql';

		if (source.provider === 'sqlite')
		{
			source.file = sn.getAttribute('file') || '';
			source.folder = HmiSql.normalizeFolder(sn.getAttribute('folder'));
		}
		else
		{
			source.host = sn.getAttribute('host') || '';
			source.port = sn.getAttribute('port') || '';
			source.database = sn.getAttribute('database') || '';
			source.user = sn.getAttribute('user') || '';
			source.password = sn.getAttribute('password') || '';
			source.options = {encrypt: sn.getAttribute('encrypt') === '1',
				trustServerCertificate: sn.getAttribute('trustServerCertificate') !== '0',
				legacyTls: sn.getAttribute('legacyTls') === '1',
				instanceName: sn.getAttribute('instanceName') || ''};
		}

		source.timeoutMs = sn.getAttribute('timeoutMs') || '';
		project.dataSources.push(source);
	}

	var listNodes = node.getElementsByTagName('bindList');

	for (var i = 0; i < listNodes.length; i++)
	{
		var bln = listNodes[i];
		var bindList = HmiSql.newBindList((bln.getAttribute('name') || '').trim());
		// Asked of this list's node, not the project's: every list's items
		// would come back otherwise
		var itemNodes = bln.getElementsByTagName('bindItem');

		for (var j = 0; j < itemNodes.length; j++)
		{
			var itn = itemNodes[j];
			bindList.items.push({tag: itn.getAttribute('tag') || '',
				field: itn.getAttribute('field') || '',
				column: itn.getAttribute('column') || '',
				delim: itn.getAttribute('delim') || ''});
		}

		project.bindLists.push(bindList);
	}

	var templateNodes = node.getElementsByTagName('tableTemplate');

	for (var i = 0; i < templateNodes.length; i++)
	{
		var tn = templateNodes[i];
		var template = HmiSql.newTemplate((tn.getAttribute('name') || '').trim());
		var columnNodes = tn.getElementsByTagName('templateColumn');

		for (var j = 0; j < columnNodes.length; j++)
		{
			var cn = columnNodes[j];
			template.columns.push({name: cn.getAttribute('name') || '',
				type: HmiSql.normalizeType(cn.getAttribute('type')),
				length: cn.getAttribute('length') || '',
				scale: cn.getAttribute('scale') || '',
				index: HmiSql.normalizeIndex(cn.getAttribute('index')),
				allowNull: cn.getAttribute('allowNull') !== '0'});
		}

		project.tableTemplates.push(template);
	}

	var queryNodes = node.getElementsByTagName('query');

	for (var i = 0; i < queryNodes.length; i++)
	{
		var qn = queryNodes[i];
		var query = HmiSql.newQuery((qn.getAttribute('name') || '').trim());
		var sqlNodes = qn.getElementsByTagName('querySql');

		if (sqlNodes.length > 0)
		{
			query.sql = HmiProject.scriptText(sqlNodes[0]);
		}

		project.queries.push(query);
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
		if (n.getAttribute('movable') === '1') { w.movable = true; }
		if (n.getAttribute('type')) { w.type = n.getAttribute('type'); }
		if (n.getAttribute('everyMs')) { w.everyMs = n.getAttribute('everyMs'); }

		var titleStrings = ['titleFont', 'titleFill', 'titleColor'];

		for (var j = 0; j < titleStrings.length; j++)
		{
			if (n.getAttribute(titleStrings[j]))
			{
				w[titleStrings[j]] = n.getAttribute(titleStrings[j]);
			}
		}

		var titleNumbers = ['titleHeight', 'titleFontSize'];

		for (var j = 0; j < titleNumbers.length; j++)
		{
			var tn = parseInt(n.getAttribute(titleNumbers[j]), 10);

			if (!isNaN(tn))
			{
				w[titleNumbers[j]] = tn;
			}
		}

		for (var j = 0; j < HmiProject.WINDOW_SCRIPTS.length; j++)
		{
			var key = HmiProject.WINDOW_SCRIPTS[j];
			var list = n.getElementsByTagName(key);

			if (list.length > 0 && HmiProject.scriptText(list[0]) !== '')
			{
				w[key] = HmiProject.scriptText(list[0]);
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

	// An indirect tag is only a name, a type and a comment
	if (HmiTypes.isIndirect(tag.type))
	{
		tag.comment = node.getAttribute('comment') || '';

		return tag;
	}

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

	tag.alarms = HmiProject.attrsOf(node, 'alarms', true, ['state']);
	tag.sim = HmiProject.attrsOf(node, 'sim', false);

	return tag;
};

/**
 * Collects the attributes of the first child element with the given name.
 * Returns null when absent so that an unused section is not written back.
 */
/** stringKeys stay strings when numeric is set (e.g. a discrete alarm's state). */
HmiProject.attrsOf = function(node, name, numeric, stringKeys)
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
		var key = attrs[i].name;
		res[key] = (numeric && (stringKeys == null || stringKeys.indexOf(key) < 0)) ?
			parseFloat(v) : v;
	}

	return res;
};
