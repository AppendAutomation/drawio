/**
 * Command-line check and publish (append-hmi-studio --hmi-check / --hmi-publish,
 * see src/main/electron.js runHmiCli). The page opens hidden with hmicli=check
 * or hmicli=publish: this loads the project the main process read, runs the
 * same validation as HMI > Validate Expressions on every page, reports it,
 * and for publish hands the project's runtime settings to the Publisher.
 */
HmiCli = function() {};

HmiCli.isActive = function()
{
	return urlParams['hmicli'] != null && window.electron != null &&
		typeof window.electron.request === 'function';
};

HmiCli.request = function(action, args)
{
	return new Promise(function(resolve, reject)
	{
		var msg = args || {};
		msg.action = action;

		window.electron.request(msg, resolve, function(message)
		{
			reject(new Error(message));
		});
	});
};

HmiCli.fail = function(message)
{
	HmiCli.request('hmiCli.fail', {message: message})['catch'](function() {});
};

HmiCli.start = function(ui)
{
	HmiCli.request('hmiCli.project').then(function(project)
	{
		if (project.mode === 'build')
		{
			return HmiCli.build(ui, project);
		}

		var file = new LocalFile(ui, project.xml, project.title, true);
		ui.fileLoaded(file);

		if (ui.getCurrentFile() !== file)
		{
			throw new Error('the file could not be opened');
		}

		if (ui.fileNode == null || ui.fileNode.getAttribute(HmiFile.VERSION_ATTRIBUTE) == null ||
			ui.hmiProject == null)
		{
			throw new Error(project.title + ' is not an HMI application (no tag dictionary)');
		}

		if (project.mode === 'render')
		{
			return HmiCli.render(ui);
		}

		if (project.mode === 'dump')
		{
			return HmiCli.request('hmiCli.write', {text: JSON.stringify(HmiCli.dump(ui), null, 2)});
		}

		HmiCli.checkAll(ui, function(problems)
		{
			HmiCli.request('hmiCli.report', {problems: problems}).then(function()
			{
				if (project.mode === 'publish')
				{
					return HmiCli.request('hmiCli.publish', {options: HmiCli.publishOptions(ui, project)});
				}
			})['catch'](function(e)
			{
				HmiCli.fail(e.message);
			});
		});
	})['catch'](function(e)
	{
		HmiCli.fail(e.message);
	});
};

/** Each page as a PNG (the HMI objects draw with their preview shapes). */
HmiCli.render = function(ui)
{
	var pages = ui.pages.slice(0);
	var index = 0;

	var next = function()
	{
		if (index >= pages.length)
		{
			HmiCli.request('hmiCli.done')['catch'](function() {});

			return;
		}

		var i = index++;
		ui.selectPage(pages[i]);
		var graph = ui.editor.graph;
		var bg = (graph.background != null && graph.background !== mxConstants.NONE) ?
			graph.background : '#ffffff';

		ui.editor.exportToCanvas(function(canvas)
		{
			HmiCli.request('hmiCli.image', {index: i, page: pages[i].getName(),
				data: canvas.toDataURL('image/png')}).then(next)['catch'](function(e)
			{
				HmiCli.fail(e.message);
			});
		}, null, null, bg, function(e)
		{
			HmiCli.fail('page ' + pages[i].getName() + ' could not be drawn: ' + ((e && e.message) || e));
		}, null, true, 1, false, false, null, null, 10);
	};

	next();
};

/** Validate on each page in turn (collectProblems looks at the page shown). */
HmiCli.checkAll = function(ui, fn)
{
	var pages = (ui.pages != null && ui.pages.length > 0) ? ui.pages.slice(0) : [null];
	var all = [];
	var seen = {};
	var index = 0;

	var next = function()
	{
		if (index >= pages.length)
		{
			fn(all);

			return;
		}

		var page = pages[index++];

		if (page != null && page !== ui.currentPage)
		{
			ui.selectPage(page);
		}

		HmiMenus.collectProblems(ui, function(problems)
		{
			for (var i = 0; i < problems.length; i++)
			{
				var p = problems[i];
				var cell = p.cell;
				var label = (cell != null) ? ui.editor.graph.convertValueToString(cell) : '';
				var item = {page: p.page || '', link: p.link || '',
					object: (cell != null) ? ('cell ' + cell.id + (label ? ' "' + label + '"' : '')) : '',
					message: p.message};

				// Project-wide problems (tags, windows) repeat on every page
				var key = item.object + '|' + item.link + '|' + item.message;

				if (!seen[key] || cell != null)
				{
					seen[key] = true;
					all.push(item);
				}
			}

			next();
		});
	};

	next();
};

/** The Publish dialog's options, from the command line and the project. */
HmiCli.publishOptions = function(ui, project)
{
	var o = project.options || {};
	var s = ui.hmiProject.settings;

	return {
		productName: o.product || project.title.replace(/\.(ahmi|drawio-hmi|drawio)$/i, ''),
		version: o.appVersion || '1.0.0',
		publisher: o.publisher || '',
		scope: o.scope || 'user',
		desktop: o.desktop === true,
		autostart: o.autostart === true,
		compression: o.compression || 'small',
		width: s.width,
		height: s.height,
		runtime: s.runtime
	};
};

// ================================================================= spec
//
// The JSON spec (doc/HMI_AUTOMATION.md): what --hmi-build turns into an .ahmi
// and --hmi-dump writes out. Plain data, so a program can write it without
// knowing the file format.

HmiCli.SPEC_VERSION = 1;

/** Object "type" shorthands: the draw.io style each starts from. */
HmiCli.TYPES = {
	rect: 'rounded=0;whiteSpace=wrap;html=1;',
	roundedRect: 'rounded=1;whiteSpace=wrap;html=1;',
	ellipse: 'ellipse;whiteSpace=wrap;html=1;',
	text: 'text;html=1;align=center;verticalAlign=middle;whiteSpace=wrap;',
	button: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontStyle=1;',
	line: 'line;strokeWidth=2;html=1;',
	arrow: 'shape=singleArrow;whiteSpace=wrap;html=1;',
	triangle: 'triangle;whiteSpace=wrap;html=1;',
	cylinder: 'shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;',
	alarmList: 'html=1;noLabel=1;shape=hmiAlarmList;fontSize=12;',
	alarmHistory: 'html=1;noLabel=1;shape=hmiAlarmHistory;fontSize=12;',
	recipeList: 'html=1;noLabel=1;shape=hmiRecipeList;fontSize=14;',
	arc: HmiArc.ELLIPSE_STYLE,
	circleArc: HmiArc.CIRCLE_STYLE
};

HmiCli.RECIPE_BOOK_FIELDS = ['name', 'uploadDownload', 'items', 'recipes'];

HmiCli.TAG_FIELDS = ['comment', 'engUnits', 'initial', 'minEU', 'maxEU', 'scaled', 'minRaw', 'maxRaw',
	'device', 'address', 'onMsg', 'offMsg', 'scanMs', 'alarms', 'sim', 'retentive'];

HmiCli.DEVICE_FIELDS = ['host', 'port', 'timeoutMs', 'scanMs', 'enabled', 'options'];

HmiCli.USER_FIELDS = ['name', 'level', 'password', 'salt', 'hash', 'iterations'];

HmiCli.WINDOW_FIELDS = ['titleBar', 'type', 'x', 'y', 'width', 'height', 'onShow', 'whileShowing',
	'onHide', 'everyMs'];

HmiCli.OBJECT_FIELDS = ['id', 'type', 'style', 'x', 'y', 'width', 'height', 'label', 'links', 'children'];

HmiCli.EDGE_FIELDS = ['id', 'edge', 'style', 'label', 'source', 'target', 'sourcePoint', 'targetPoint',
	'points', 'links'];

/** Link fields beyond each type's defaults. */
HmiCli.EXTRA_LINK_FIELDS = {orientation: ['pivot', 'pivotDx', 'pivotDy']};

HmiCli.unknownFields = function(obj, fields, what, errors)
{
	for (var key in obj)
	{
		if (mxUtils.indexOf(fields, key) < 0)
		{
			errors.push(what + ': unknown field "' + key + '"');
		}
	}
};

/** Builds the project from the spec, writes it, then checks it. */
HmiCli.build = function(ui, project)
{
	var spec;

	try
	{
		spec = JSON.parse(project.xml);
	}
	catch (e)
	{
		throw new Error('the spec is not valid JSON: ' + e.message);
	}

	var errors = [];
	var title = project.outputTitle || 'project.ahmi';
	var file = new LocalFile(ui, ui.emptyDiagramXml, title, true);
	ui.fileLoaded(file);

	var hmi = HmiCli.buildProject(spec, errors);
	ui.hmiProject = hmi;

	HmiCli.buildPages(ui, spec, hmi, errors);

	if (errors.length > 0)
	{
		throw new Error('the spec has errors:\n  ' + errors.join('\n  '));
	}

	return HmiCli.applyPassword(hmi, spec).then(function()
	{
		var xml = ui.getFileData(true, null, null, null, true, false, null, null, null, true);

		return HmiCli.request('hmiCli.write', {text: xml});
	}).then(function()
	{
		HmiCli.checkAll(ui, function(problems)
		{
			HmiCli.request('hmiCli.report', {problems: problems})['catch'](function(e)
			{
				HmiCli.fail(e.message);
			});
		});
	});
};

HmiCli.copyFields = function(target, source, fields, what, errors)
{
	for (var key in source)
	{
		if (mxUtils.indexOf(fields, key) >= 0)
		{
			target[key] = source[key];
		}
		else if (key !== 'name' && key !== 'type' && key !== 'protocol')
		{
			errors.push(what + ': unknown field "' + key + '"');
		}
	}
};

HmiCli.buildProject = function(spec, errors)
{
	var hmi = new HmiProject();
	var devices = spec.devices || [];
	var tags = spec.tags || [];

	if (spec.version != null && spec.version !== HmiCli.SPEC_VERSION)
	{
		errors.push('spec version ' + spec.version + ' is not supported (this studio reads ' +
			HmiCli.SPEC_VERSION + ')');
	}

	for (var i = 0; i < devices.length; i++)
	{
		var d = devices[i];

		if (!d || !d.name || HmiProject.protocol(d.protocol) == null)
		{
			errors.push('device ' + (i + 1) + ': needs a name and a protocol (' +
				HmiProject.PROTOCOLS.map(function(p) { return p.value; }).join(', ') + ')');
			continue;
		}

		var device = HmiProject.createDevice(d.name, d.protocol);
		var options = device.options;
		HmiCli.copyFields(device, d, HmiCli.DEVICE_FIELDS, 'device ' + d.name, errors);
		device.options = JSON.parse(JSON.stringify(options));

		for (var k in (d.options || {}))
		{
			device.options[k] = d.options[k];
		}

		hmi.devices.push(device);
	}

	for (var i = 0; i < tags.length; i++)
	{
		var t = tags[i];

		if (!t || !t.name || mxUtils.indexOf(HmiTypes.TAG_TYPES, t.type) < 0)
		{
			errors.push('tag ' + (i + 1) + ': needs a name and a type (' + HmiTypes.TAG_TYPES.join(', ') + ')');
			continue;
		}

		try
		{
			var tag = HmiProject.createTag(t.name, t.type);
			HmiCli.copyFields(tag, t, HmiTypes.isIndirect(t.type) ? ['comment'] : HmiCli.TAG_FIELDS,
				'tag ' + t.name + (HmiTypes.isIndirect(t.type) ? ' (an indirect tag takes only a comment)' : ''), errors);
			hmi.addTag(tag);
		}
		catch (e)
		{
			errors.push('tag ' + t.name + ': ' + e.message);
		}
	}

	var s = spec.settings || {};

	if (s.width != null) { hmi.settings.width = parseInt(s.width, 10) || hmi.settings.width; }
	if (s.height != null) { hmi.settings.height = parseInt(s.height, 10) || hmi.settings.height; }

	var rt = s.runtime || {};

	if (rt.windowMode != null)
	{
		if (mxUtils.indexOf(HmiProject.WINDOW_MODES, rt.windowMode) < 0)
		{
			errors.push('settings.runtime.windowMode: one of ' + HmiProject.WINDOW_MODES.join(', '));
		}

		hmi.settings.runtime.windowMode = rt.windowMode;
	}

	if (rt.exit != null)
	{
		if (mxUtils.indexOf(HmiProject.EXIT_MODES, rt.exit) < 0)
		{
			errors.push('settings.runtime.exit: one of ' + HmiProject.EXIT_MODES.join(', '));
		}

		hmi.settings.runtime.exit = rt.exit;
	}

	// A dumped project carries the hash; a new one may give a password
	if (rt.salt && rt.hash)
	{
		hmi.settings.runtime.salt = rt.salt;
		hmi.settings.runtime.hash = rt.hash;
	}
	else if (hmi.settings.runtime.exit === 'password' && !rt.exitPassword)
	{
		errors.push('settings.runtime: exit "password" needs exitPassword');
	}

	if (s.publish != null)
	{
		hmi.settings.publish = JSON.parse(JSON.stringify(s.publish));
	}

	if (s.security != null)
	{
		for (var key in s.security)
		{
			if (key !== 'autoLogoutMin')
			{
				errors.push('settings.security: unknown field "' + key + '" (allowed: autoLogoutMin)');
			}
		}

		var logout = Number(s.security.autoLogoutMin || 0);

		if (!(logout >= 0 && logout <= 1440 && Math.floor(logout) === logout))
		{
			errors.push('settings.security.autoLogoutMin: whole minutes from 0 to 1440');
		}

		hmi.settings.security.autoLogoutMin = logout;
	}

	HmiCli.buildUsers(hmi, spec.users || [], errors);
	HmiCli.buildRecipeBooks(hmi, spec.recipeBooks || [], errors);

	return hmi;
};

/**
 * Users: {name, level, password} is hashed here; a dump gives salt, hash
 * and iterations instead, so no password is ever written to a project.
 */
HmiCli.buildUsers = function(hmi, users, errors)
{
	for (var i = 0; i < users.length; i++)
	{
		var u = users[i] || {};
		var what = 'user ' + (u.name || (i + 1));

		for (var key in u)
		{
			if (mxUtils.indexOf(HmiCli.USER_FIELDS, key) < 0)
			{
				errors.push(what + ': unknown field "' + key + '" (allowed: ' +
					HmiCli.USER_FIELDS.join(', ') + ')');
			}
		}

		if (!HmiSecurity.validName(u.name))
		{
			errors.push(what + ': the name must be 1 to 32 letters, digits, spaces or ._@- and not "None"');
			continue;
		}

		if (HmiSecurity.findUser(hmi.users, u.name) != null)
		{
			errors.push(what + ': defined twice');
			continue;
		}

		var level = (u.level == null) ? 0 : Number(u.level);

		if (!HmiSecurity.validLevel(level))
		{
			errors.push(what + ': level must be a whole number from 0 to 9999');
			continue;
		}

		var user = {name: u.name, level: level};

		if (u.salt && u.hash)
		{
			user.salt = String(u.salt);
			user.hash = String(u.hash);
			user.iterations = Number(u.iterations) || HmiSecurity.ITERATIONS;
		}
		else if (u.password != null && String(u.password) !== '')
		{
			var h = HmiSecurity.hashPassword(String(u.password));
			user.salt = h.salt;
			user.hash = h.hash;
			user.iterations = h.iterations;
		}
		else
		{
			errors.push(what + ': needs a password');
			continue;
		}

		hmi.users.push(user);
	}
};

HmiCli.applyPassword = function(hmi, spec)
{
	var rt = (spec.settings || {}).runtime || {};

	if (hmi.settings.runtime.exit !== 'password' || !rt.exitPassword)
	{
		return Promise.resolve();
	}

	var salt = HmiProject.randomSalt();

	return HmiProject.hashPassword(salt, String(rt.exitPassword)).then(function(hash)
	{
		hmi.settings.runtime.salt = salt;
		hmi.settings.runtime.hash = hash;
	});
};

HmiCli.buildPages = function(ui, spec, hmi, errors)
{
	var pages = spec.pages || [];
	var byName = {};

	if (pages.length === 0)
	{
		errors.push('the spec has no pages');

		return;
	}

	for (var i = 0; i < pages.length; i++)
	{
		var ps = pages[i] || {};
		var name = ps.name || ('Page-' + (i + 1));
		var page;

		if (byName[name.toLowerCase()] != null)
		{
			errors.push('page "' + name + '": duplicate page name');
			continue;
		}

		if (i === 0)
		{
			page = ui.pages[0];
			page.setName(name);
		}
		else
		{
			// insertPage does nothing while the graph is disabled, as it is
			// in this chromeless page, so the same change is made directly
			page = ui.createPage(name, ui.createPageId());
			ui.editor.graph.model.execute(new ChangePage(ui, page, page, ui.pages.length));
		}

		byName[name.toLowerCase()] = page;
		ui.selectPage(page);

		var graph = ui.editor.graph;

		if (ps.background)
		{
			ui.setBackgroundColor(ps.background);
		}

		var ids = {};
		graph.getModel().beginUpdate();

		try
		{
			HmiCli.buildCells(graph, graph.getDefaultParent(), ps.objects || [], ids,
				'page "' + name + '"', errors);
		}
		finally
		{
			graph.getModel().endUpdate();
		}

		if (ps.window != null)
		{
			var w = {};
			HmiCli.copyFields(w, ps.window, HmiCli.WINDOW_FIELDS, 'page "' + name + '" window', errors);

			if (w.type != null && mxUtils.indexOf(HmiProject.WINDOW_TYPES, w.type) < 0)
			{
				errors.push('page "' + name + '" window.type: one of ' + HmiProject.WINDOW_TYPES.join(', '));
			}

			hmi.setWindow(page.getId(), w);
		}
	}

	var startup = (spec.settings || {}).startup || [];

	for (var i = 0; i < startup.length; i++)
	{
		var p = byName[String(startup[i]).toLowerCase()];

		if (p == null)
		{
			errors.push('settings.startup: no page "' + startup[i] + '"');
		}
		else
		{
			hmi.settings.startup.push(p.getId());
		}
	}

	ui.selectPage(ui.pages[0]);
};

/** Objects, connectors and their children, depth first. */
HmiCli.buildCells = function(graph, parent, objects, ids, where, errors)
{
	var edges = [];

	for (var i = 0; i < objects.length; i++)
	{
		var o = objects[i] || {};
		var what = where + ' object ' + (o.id || (i + 1));

		if (o.id != null && ids[o.id] != null)
		{
			errors.push(what + ': duplicate id');
			continue;
		}

		if (o.edge)
		{
			edges.push(o);
			continue;
		}

		HmiCli.unknownFields(o, HmiCli.OBJECT_FIELDS, what, errors);

		if (o.type != null && HmiCli.TYPES[o.type] == null)
		{
			errors.push(what + ': unknown type "' + o.type + '" (' + Object.keys(HmiCli.TYPES).join(', ') + ')');
		}

		var style = ((o.type != null) ? (HmiCli.TYPES[o.type] || '') : '') + (o.style || '');
		var cell = graph.insertVertex(parent, (o.id != null) ? String(o.id) : null,
			(o.label != null) ? String(o.label) : '', HmiCli.num(o.x), HmiCli.num(o.y),
			HmiCli.num(o.width, 120), HmiCli.num(o.height, 60), style || HmiCli.TYPES.rect);

		ids[cell.id] = cell;
		HmiCli.applyLinks(graph, cell, o.links, what, errors);

		if (o.children != null)
		{
			HmiCli.buildCells(graph, cell, o.children, ids, what, errors);
		}
	}

	for (var i = 0; i < edges.length; i++)
	{
		var e = edges[i];
		var what = where + ' connector ' + (e.id || (i + 1));
		HmiCli.unknownFields(e, HmiCli.EDGE_FIELDS, what, errors);
		var src = (e.source != null) ? ids[e.source] : null;
		var trg = (e.target != null) ? ids[e.target] : null;

		if ((e.source != null && src == null) || (e.target != null && trg == null))
		{
			errors.push(what + ': source or target is not an object id on this page');
		}

		var edge = graph.insertEdge(parent, (e.id != null) ? String(e.id) : null,
			(e.label != null) ? String(e.label) : '', src, trg,
			e.style || 'endArrow=classic;html=1;');

		if (e.sourcePoint != null) { edge.geometry.setTerminalPoint(new mxPoint(e.sourcePoint[0], e.sourcePoint[1]), true); }
		if (e.targetPoint != null) { edge.geometry.setTerminalPoint(new mxPoint(e.targetPoint[0], e.targetPoint[1]), false); }

		if (e.points != null)
		{
			edge.geometry.points = e.points.map(function(p) { return new mxPoint(p[0], p[1]); });
		}

		ids[edge.id] = edge;
		HmiCli.applyLinks(graph, edge, e.links, what, errors);
	}
};

HmiCli.num = function(v, def)
{
	var n = parseFloat(v);

	return isNaN(n) ? (def || 0) : n;
};

/** Links over each type's defaults, so a spec gives only what differs. */
HmiCli.applyLinks = function(graph, cell, links, what, errors)
{
	if (links == null)
	{
		return;
	}

	var out = {};

	for (var key in links)
	{
		var def = HmiTypes.LINKS[key];

		if (def == null)
		{
			errors.push(what + ': unknown link "' + key + '"');
			continue;
		}

		var cfg = def.defaults();
		var allowed = Object.keys(cfg).concat(HmiCli.EXTRA_LINK_FIELDS[key] || []);

		for (var k in links[key])
		{
			if (mxUtils.indexOf(allowed, k) < 0)
			{
				errors.push(what + ' link ' + key + ': unknown field "' + k + '" (' + allowed.join(', ') + ')');
			}

			cfg[k] = links[key][k];
		}

		out[key] = cfg;
	}

	HmiProject.setCellLinks(graph, cell, out);
};

/**
 * Recipe books: [{name, uploadDownload, items: [{tag, ioTag}] or ["tag"],
 * recipes: {name: {tag: value}}}].
 */
HmiCli.buildRecipeBooks = function(hmi, books, errors)
{
	if (!Array.isArray(books))
	{
		errors.push('recipeBooks: must be a list');

		return;
	}

	for (var i = 0; i < books.length; i++)
	{
		var b = books[i] || {};
		var what = 'recipe book ' + (b.name || (i + 1));

		for (var key in b)
		{
			if (mxUtils.indexOf(HmiCli.RECIPE_BOOK_FIELDS, key) < 0)
			{
				errors.push(what + ': unknown field "' + key + '" (allowed: ' + HmiCli.RECIPE_BOOK_FIELDS.join(', ') + ')');
			}
		}

		if (!HmiRecipes.validName(b.name))
		{
			errors.push(what + ': the name must be 1 to 64 characters');
			continue;
		}

		if (HmiRecipes.findBook(hmi.recipeBooks, b.name) != null)
		{
			errors.push(what + ': defined twice');
			continue;
		}

		var book = HmiRecipes.newBook(b.name.trim());
		book.uploadDownload = b.uploadDownload === true;

		(Array.isArray(b.items) ? b.items : []).forEach(function(it, j)
		{
			var item = (typeof it === 'string') ? {tag: it} : (it || {});

			for (var k in item)
			{
				if (k !== 'tag' && k !== 'ioTag')
				{
					errors.push(what + ' item ' + (j + 1) + ': unknown field "' + k + '" (allowed: tag, ioTag)');
				}
			}

			if (item.ioTag && !book.uploadDownload)
			{
				errors.push(what + ' item ' + (j + 1) + ': ioTag needs "uploadDownload": true');
			}

			book.items.push({tag: String(item.tag || ''), ioTag: String(item.ioTag || '')});
		});

		var problems = HmiRecipes.bookProblems(hmi, book);

		for (var p = 0; p < problems.length; p++)
		{
			errors.push(what + ': ' + problems[p]);
		}

		var recipes = b.recipes || {};

		for (var name in recipes)
		{
			if (!HmiRecipes.validName(name) || recipes[name] == null || typeof recipes[name] !== 'object')
			{
				errors.push(what + ': recipe "' + name + '" needs a name of 1 to 64 characters and {tag: value}');
				continue;
			}

			book.recipes[name] = {};

			for (var tag in recipes[name])
			{
				var v = recipes[name][tag];

				if (typeof v !== 'number' && typeof v !== 'string')
				{
					errors.push(what + ' recipe "' + name + '": ' + tag + ' must be a number or text');
				}
				else
				{
					book.recipes[name][tag] = v;
				}
			}
		}

		hmi.recipeBooks.push(book);
	}
};

/** The open project as a spec. */
HmiCli.dump = function(ui)
{
	var hmi = ui.hmiProject;
	var pick = function(obj, fields)
	{
		var out = {};

		for (var i = 0; i < fields.length; i++)
		{
			if (obj[fields[i]] != null && obj[fields[i]] !== '')
			{
				var v = obj[fields[i]];

				// mxUtils.clone makes an empty wrapper of a string or number
				out[fields[i]] = (v != null && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
			}
		}

		return out;
	};

	var spec = {version: HmiCli.SPEC_VERSION, settings: {width: hmi.settings.width,
		height: hmi.settings.height, startup: [], runtime: JSON.parse(JSON.stringify(hmi.settings.runtime)),
		publish: JSON.parse(JSON.stringify(hmi.settings.publish))}, devices: [], tags: [], pages: []};

	if (!spec.settings.runtime.hash)
	{
		delete spec.settings.runtime.salt;
		delete spec.settings.runtime.hash;
	}

	if (hmi.settings.security.autoLogoutMin > 0)
	{
		spec.settings.security = {autoLogoutMin: hmi.settings.security.autoLogoutMin};
	}

	if (hmi.users.length > 0)
	{
		spec.users = hmi.users.map(function(u)
		{
			return {name: u.name, level: u.level, salt: u.salt, hash: u.hash, iterations: u.iterations};
		});
	}

	if (hmi.recipeBooks.length > 0)
	{
		spec.recipeBooks = hmi.recipeBooks.map(function(b)
		{
			var out = {name: b.name};

			if (b.uploadDownload)
			{
				out.uploadDownload = true;
			}

			out.items = b.items.map(function(it) { return (b.uploadDownload) ? {tag: it.tag, ioTag: it.ioTag} : {tag: it.tag}; });

			if (Object.keys(b.recipes).length > 0)
			{
				out.recipes = JSON.parse(JSON.stringify(b.recipes));
			}

			return out;
		});
	}

	for (var i = 0; i < hmi.devices.length; i++)
	{
		var d = hmi.devices[i];
		var dev = {name: d.name, protocol: d.protocol};
		var rest = pick(d, HmiCli.DEVICE_FIELDS);

		for (var k in rest) { dev[k] = rest[k]; }

		spec.devices.push(dev);
	}

	for (var i = 0; i < hmi.tags.length; i++)
	{
		var t = hmi.tags[i];
		var tag = {name: t.name, type: t.type};
		var rest = pick(t, HmiCli.TAG_FIELDS);

		for (var k in rest) { tag[k] = rest[k]; }

		if (tag.alarms != null && Object.keys(tag.alarms).length === 0) { delete tag.alarms; }
		if (tag.sim != null && Object.keys(tag.sim).length === 0) { delete tag.sim; }

		spec.tags.push(tag);
	}

	var current = ui.currentPage;

	for (var i = 0; i < ui.pages.length; i++)
	{
		var page = ui.pages[i];
		ui.selectPage(page);
		var graph = ui.editor.graph;
		var ps = {name: page.getName()};

		if (graph.background != null && graph.background !== mxConstants.NONE)
		{
			ps.background = graph.background;
		}

		if (hmi.windows[page.getId()] != null)
		{
			ps.window = JSON.parse(JSON.stringify(hmi.windows[page.getId()]));
		}

		ps.objects = HmiCli.dumpCells(graph, graph.getDefaultParent());
		spec.pages.push(ps);

		if (mxUtils.indexOf(hmi.settings.startup, page.getId()) >= 0)
		{
			spec.settings.startup.push(page.getName());
		}
	}

	if (current != null)
	{
		ui.selectPage(current);
	}

	return spec;
};

HmiCli.dumpCells = function(graph, parent)
{
	var model = graph.getModel();
	var list = [];

	for (var i = 0; i < model.getChildCount(parent); i++)
	{
		var cell = model.getChildAt(parent, i);
		var geo = model.getGeometry(cell);
		var o = {id: cell.id};

		if (model.isEdge(cell))
		{
			o.edge = true;

			if (model.getTerminal(cell, true) != null) { o.source = model.getTerminal(cell, true).id; }
			if (model.getTerminal(cell, false) != null) { o.target = model.getTerminal(cell, false).id; }

			if (geo != null)
			{
				var sp = geo.getTerminalPoint(true);
				var tp = geo.getTerminalPoint(false);

				if (sp != null) { o.sourcePoint = [sp.x, sp.y]; }
				if (tp != null) { o.targetPoint = [tp.x, tp.y]; }
				if (geo.points != null && geo.points.length > 0) { o.points = geo.points.map(function(p) { return [p.x, p.y]; }); }
			}
		}
		else if (model.isVertex(cell) && geo != null)
		{
			o.x = geo.x;
			o.y = geo.y;
			o.width = geo.width;
			o.height = geo.height;
		}
		else
		{
			continue;
		}

		var label = graph.convertValueToString(cell);

		if (label) { o.label = label; }
		if (cell.style) { o.style = cell.style; }

		var links = HmiProject.getCellLinks(graph, cell);

		if (Object.keys(links).length > 0) { o.links = links; }

		if (model.isVertex(cell) && model.getChildCount(cell) > 0)
		{
			o.children = HmiCli.dumpCells(graph, cell);
		}

		list.push(o);
	}

	return list;
};
