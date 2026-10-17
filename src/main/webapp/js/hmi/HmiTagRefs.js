/**
 * Where a project names a tag, and how those names are rewritten.
 *
 * The classification is driven by the link registry's refs/refArrays
 * (HmiTypes), so a new link field is classified where it is defined, and one
 * model serves Edit > Find/Replace Tag References, the Tag Dictionary's
 * rename and its delete count, HMI > Validate and the run time's
 * subscriptions.
 *
 * A rewrite always takes a whole map of names at once, never one name after
 * another: every site is matched against the original text exactly once, so
 * swapping two tags works and a rename can never cascade into a name it has
 * just written.
 */
HmiTagRefs = function() {};

/**
 * Link config fields that never name a tag. Only the self test reads this: it
 * checks every field a link defines is classified here or in the registry, so
 * a field added later cannot be missed silently.
 */
HmiTagRefs.IGNORED_FIELDS = {
	'on': true, 'off': true, 'loLo': true, 'low': true, 'normal': true,
	'high': true, 'hiHi': true, 'sense': true, 'attrs': true, 'fill': true,
	'line': true, 'text': true, 'blank': true, 'kind': true, 'action': true,
	'format': true, 'prefix': true, 'suffix': true, 'onText': true,
	'offText': true, 'prompt': true, 'keypad': true, 'masked': true,
	'window': true, 'book': true, 'title': true, 'arrows': true,
	'name': true, 'spanSec': true, 'sampleMs': true, 'refreshMs': true,
	'gridColor': true, 'anchor': true, 'pivot': true, 'pivotDx': true,
	'pivotDy': true
};

/**
 * Script functions that take a tag name as text, and which of their arguments
 * it is. TrendSetPen's first argument is a trend's name, not a tag's, so a
 * tag that happens to share the trend's name must not be rewritten there.
 */
HmiTagRefs.NAME_ARGS = {'linkindirecttag': [0, 1], 'trendsetpen': [1]};

/** The InTouch qualifier, which parseReference folds back to the bare name. */
HmiTagRefs.QUALIFIER = 'intouch';

// -------------------------------------------------------------- field roles

/**
 * Field name -> role and array holder -> fields, over every link, for callers
 * that have a config but not its link key. Memoized rather than built at load
 * time, so this file does not care where it sits in the load order.
 *
 * @returns {Object} {byField, byArray, conflicts}: conflicts names any field
 * two links classify differently, which the self test requires to be empty.
 */
HmiTagRefs.roles = function()
{
	if (HmiTagRefs.roleCache == null)
	{
		var byField = {};
		var byArray = {};
		var conflicts = [];

		for (var key in HmiTypes.LINKS)
		{
			var def = HmiTypes.LINKS[key];

			for (var field in def.refs)
			{
				if (byField[field] != null && byField[field] !== def.refs[field])
				{
					conflicts.push(field);
				}

				byField[field] = def.refs[field];
			}

			for (var name in def.refArrays)
			{
				byArray[name] = byArray[name] || {};

				for (var f in def.refArrays[name])
				{
					byArray[name][f] = def.refArrays[name][f];
				}
			}
		}

		HmiTagRefs.roleCache = {byField: byField, byArray: byArray,
			conflicts: conflicts};
	}

	return HmiTagRefs.roleCache;
};

/**
 * Visits every field of one link config that can name a tag.
 *
 * fn({holder, field, role, key, path}) -- holder is the config itself or an
 * array element, so fn can write holder[field] back. Empty values and
 * anything that is not a string are skipped.
 *
 * opts:
 *   key      the link key, which picks that link's own field roles; without
 *            one the union over every link is used, which is what lets a
 *            caller pass a config it has assembled itself
 *   roles    only these roles ('tag', 'expr', 'script')
 *   exclude  skip an array holder, named '<link key>.<array>'
 */
HmiTagRefs.eachField = function(cfg, opts, fn)
{
	if (cfg == null || typeof cfg !== 'object')
	{
		return;
	}

	opts = opts || {};
	var def = (opts.key != null) ? HmiTypes.LINKS[opts.key] : null;
	var refs = (def != null) ? def.refs : HmiTagRefs.roles().byField;
	var arrays = (def != null) ? def.refArrays : HmiTagRefs.roles().byArray;

	var wanted = function(role)
	{
		return opts.roles == null || mxUtils.indexOf(opts.roles, role) >= 0;
	};

	for (var field in refs)
	{
		if (wanted(refs[field]) && typeof cfg[field] === 'string' &&
			cfg[field] !== '')
		{
			fn({holder: cfg, field: field, role: refs[field], key: opts.key,
				path: field});
		}
	}

	for (var name in arrays)
	{
		var label = (opts.key != null) ? opts.key + '.' + name : name;

		if (opts.exclude != null && opts.exclude[label])
		{
			continue;
		}

		var list = cfg[name];

		if (list == null || list.length == null)
		{
			continue;
		}

		for (var i = 0; i < list.length; i++)
		{
			var item = list[i];

			if (item == null || typeof item !== 'object')
			{
				continue;
			}

			for (var f in arrays[name])
			{
				if (wanted(arrays[name][f]) && typeof item[f] === 'string' &&
					item[f] !== '')
				{
					fn({holder: item, field: f, role: arrays[name][f],
						key: opts.key, path: name + '[' + i + '].' + f});
				}
			}
		}
	}
};

/**
 * Every tag-naming field of every link on a cell. The site also carries the
 * cell and the links object it came from.
 *
 * @returns {Object} the cell's links, so a caller that wrote through a site
 * can hand them to HmiProject.setCellLinks.
 */
HmiTagRefs.eachCellField = function(graph, cell, opts, fn)
{
	var links = HmiProject.getCellLinks(graph, cell);

	for (var key in links)
	{
		HmiTagRefs.eachLinkField(links[key], key, opts, cell, links, fn);
	}

	return links;
};

HmiTagRefs.eachLinkField = function(cfg, key, opts, cell, links, fn)
{
	opts = opts || {};

	HmiTagRefs.eachField(cfg, {key: key, roles: opts.roles,
		exclude: opts.exclude}, function(site)
	{
		site.cell = cell;
		site.links = links;
		fn(site);
	});
};

// ------------------------------------------------------------------- scopes

/** Every cell of the current page, groups and their contents alike. */
HmiTagRefs.pageCells = function(graph)
{
	var model = graph.getModel();
	var cells = [];

	var walk = function(parent)
	{
		var count = model.getChildCount(parent);

		for (var i = 0; i < count; i++)
		{
			var cell = model.getChildAt(parent, i);
			cells.push(cell);
			walk(cell);
		}
	};

	walk(graph.getDefaultParent());

	return cells;
};

/** The given cells and everything inside them, each cell once. */
HmiTagRefs.withDescendants = function(graph, cells)
{
	var model = graph.getModel();
	var out = [];

	var add = function(cell)
	{
		if (cell == null || mxUtils.indexOf(out, cell) >= 0)
		{
			return;
		}

		out.push(cell);
		var count = model.getChildCount(cell);

		for (var i = 0; i < count; i++)
		{
			add(model.getChildAt(cell, i));
		}
	};

	for (var i = 0; cells != null && i < cells.length; i++)
	{
		add(cells[i]);
	}

	return out;
};

/**
 * What Find/Replace works on: the selection and everything inside it, or the
 * whole page when nothing is selected. Decided once, when the dialog opens,
 * so Apply cannot act on a different set than the one listed.
 */
HmiTagRefs.scope = function(ui)
{
	var graph = ui.editor.graph;
	var selection = graph.getSelectionCells();
	var pageName = (ui.currentPage != null && ui.currentPage.getName != null) ?
		ui.currentPage.getName() : 'Page';

	if (selection != null && selection.length > 0)
	{
		return {kind: 'selection', selected: selection.length,
			cells: HmiTagRefs.withDescendants(graph, selection),
			pageName: pageName};
	}

	return {kind: 'page', selected: 0, cells: HmiTagRefs.pageCells(graph),
		pageName: pageName};
};

// -------------------------------------------------------------------- names

HmiTagRefs.escapeRe = function(text)
{
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/** Whether a name can be a tag's: the grammar the lexer accepts. */
HmiTagRefs.validName = function(name)
{
	if (HmiTagRefs.nameRe == null)
	{
		HmiTagRefs.nameRe = new RegExp('^[A-Za-z_$][A-Za-z0-9_$]{0,' +
			(HmiExpr.MAX_NAME - 1) + '}$');
	}

	return typeof name === 'string' && HmiTagRefs.nameRe.test(name);
};

/**
 * Why this name cannot replace a tag reference, or null when it can. An
 * unknown name is reported too, which is what the single tag editor is for.
 */
HmiTagRefs.checkName = function(project, name)
{
	if (name == null || name === '')
	{
		return null;
	}

	if (name.length > HmiExpr.MAX_NAME)
	{
		return 'Tag names are at most ' + HmiExpr.MAX_NAME + ' characters.';
	}

	if (!HmiTagRefs.validName(name))
	{
		return 'Tag names start with a letter, _ or $ and may contain ' +
			'letters, digits, _ and $.';
	}

	if (HmiTypes.systemTag(name) != null)
	{
		return '"' + name + '" is a system tag name and cannot be used.';
	}

	if (name.charAt(0) === '$')
	{
		return null;
	}

	if (project != null && project.getTag(name) == null)
	{
		return 'No tag named "' + name + '".';
	}

	return null;
};

/**
 * A bare tag-name field, which tolerates the qualified InTouch:Tag form and a
 * dotfield: {prefix, name, field}, or null when it is not a name at all.
 */
HmiTagRefs.parseName = function(value)
{
	if (typeof value !== 'string')
	{
		return null;
	}

	var rest = value.trim();

	if (rest === '')
	{
		return null;
	}

	var prefix = '';
	var colon = rest.indexOf(':');

	if (colon >= 0)
	{
		prefix = rest.substring(0, colon + 1);
		rest = rest.substring(colon + 1);
	}

	var field = '';
	var dot = rest.indexOf('.');

	if (dot >= 0)
	{
		field = rest.substring(dot);
		rest = rest.substring(0, dot);
	}

	if (!HmiTagRefs.validName(rest))
	{
		return null;
	}

	return {prefix: prefix, name: rest, field: field};
};

// --------------------------------------------------------- scanning scripts

/**
 * The local variables a script declares, and the tokens of its DIM
 * statements, from a token prescan.
 *
 * It mirrors HmiExpr's parseDim rather than using it, so it still works in a
 * script that has errors elsewhere -- which is exactly the script a rename is
 * most often trying to fix. A DIM anywhere in the script shields that name
 * everywhere in it: the compiler refuses a local that shares a tag's name, so
 * a script where both happen is already broken and guessing is worse than
 * leaving it alone.
 *
 * @returns {Object} {locals: {lower: true}, skip: {tokenIndex: true}}
 */
HmiTagRefs.scanDim = function(tokens)
{
	var locals = {};
	var skip = {};

	for (var i = 0; i < tokens.length; i++)
	{
		var t = tokens[i];

		if (t.type !== HmiExpr.T.IDENT || t.value.toUpperCase() !== 'DIM')
		{
			continue;
		}

		var prev = (i > 0) ? tokens[i - 1] : null;

		if (prev != null && !(prev.type === HmiExpr.T.OP && prev.value === ';'))
		{
			continue;
		}

		// Everything up to the statement's end belongs to the declaration:
		// the names, AS, and the type name, any of which could be a tag's.
		var j = i;
		var expectName = true;

		while (j < tokens.length && tokens[j].type !== HmiExpr.T.END)
		{
			var u = tokens[j];

			if (u.type === HmiExpr.T.OP && u.value === ';')
			{
				break;
			}

			skip[j] = true;

			if (j > i && u.type === HmiExpr.T.IDENT)
			{
				if (expectName && u.value.toUpperCase() !== 'AS')
				{
					locals[u.value.toLowerCase()] = true;
				}

				if (u.value.toUpperCase() === 'AS')
				{
					expectName = false;
				}
			}

			j++;
		}

		i = j;
	}

	return {locals: locals, skip: skip};
};

/**
 * Every place an expression or a script names a tag.
 *
 * Identifiers are taken from the lexer, so brace comments and string literals
 * cannot be mistaken for references, and the offsets are exact. A lexer error
 * means the offsets cannot be trusted at all, so nothing is reported and the
 * caller leaves the text alone. A compile error does not matter here: an
 * expression naming a tag that does not exist is precisely what Find/Replace
 * is for.
 *
 * @returns {Object} {sites: [{start, length, name, kind, system}], error}
 * where kind is 'ident' or 'literal' (a tag name passed to LinkIndirectTag or
 * TrendSetPen as text).
 */
HmiTagRefs.scanText = function(src, mode, shield)
{
	var out = {sites: [], error: null};

	if (typeof src !== 'string' || src === '')
	{
		return out;
	}

	var lex = new HmiExpr.Lexer(src).run();

	if (lex.errors.length > 0)
	{
		out.error = lex.errors[0].message;

		return out;
	}

	var tokens = lex.tokens;
	var dim = (mode === 'script') ? HmiTagRefs.scanDim(tokens) :
		{locals: {}, skip: {}};

	// FOR, TO, STEP, NEXT, WHILE and ENDWHILE are keywords by their position
	// rather than by the lexer (HmiExpr.LOOP_WORDS says why), so the one
	// classifier the parser uses says which of them are keywords here. Without
	// this, renaming a tag named Step would rewrite the keyword, and
	// Find/Replace would list the keywords as names.
	if (mode === 'script')
	{
		var words = HmiExpr.loopWords(tokens);

		for (var at in words)
		{
			dim.skip[at] = true;
		}
	}

	// A QuickFunction's arguments are local variables that no DIM declares,
	// so the caller names them and they are skipped like any other local.
	for (var name in (shield || {}))
	{
		dim.locals[name] = true;
	}

	for (var i = 0; i < tokens.length; i++)
	{
		var t = tokens[i];

		if (t.type !== HmiExpr.T.IDENT || dim.skip[i])
		{
			continue;
		}

		var prev = (i > 0) ? tokens[i - 1] : null;
		var next = tokens[i + 1];
		var lower = t.value.toLowerCase();

		// A name passed as text, in the arguments of the functions that take
		// one. Collected before the call's own name is skipped below.
		if (HmiTagRefs.NAME_ARGS[lower] != null && next != null &&
			next.type === HmiExpr.T.OP && next.value === '(')
		{
			HmiTagRefs.scanNameArgs(tokens, i + 1, HmiTagRefs.NAME_ARGS[lower],
				out.sites);

			continue;
		}

		// A dotfield on another tag, a function's name, or the InTouch
		// qualifier: none of them is a reference of its own.
		if (prev != null && prev.type === HmiExpr.T.OP && prev.value === '.')
		{
			continue;
		}

		if (next != null && next.type === HmiExpr.T.OP && next.value === '(')
		{
			continue;
		}

		if (lower === HmiTagRefs.QUALIFIER && next != null &&
			next.type === HmiExpr.T.OP && next.value === ':')
		{
			continue;
		}

		if (dim.locals[lower])
		{
			continue;
		}

		out.sites.push({start: t.start, length: t.length, name: t.value,
			kind: 'ident', system: HmiTypes.systemTag(t.value) != null});
	}

	return out;
};

/**
 * The tag names in the argument list that starts at the '(' token, for the
 * argument positions that hold one. Only an argument that is a single string
 * literal can be a name here; anything built at run time is beyond reach.
 */
HmiTagRefs.scanNameArgs = function(tokens, open, positions, sites)
{
	var depth = 0;
	var arg = 0;
	var run = [];

	var finish = function()
	{
		if (run.length === 1 && run[0].type === HmiExpr.T.STRING &&
			mxUtils.indexOf(positions, arg) >= 0)
		{
			var name = ('' + run[0].value).trim();

			if (HmiTagRefs.validName(name))
			{
				sites.push({start: run[0].start, length: run[0].length,
					name: name, kind: 'literal',
					system: HmiTypes.systemTag(name) != null});
			}
		}

		run = [];
	};

	for (var i = open; i < tokens.length; i++)
	{
		var t = tokens[i];

		if (t.type === HmiExpr.T.END)
		{
			break;
		}

		if (t.type === HmiExpr.T.OP && (t.value === '(' || t.value === ')'))
		{
			depth += (t.value === '(') ? 1 : -1;

			if (depth === 0)
			{
				finish();

				break;
			}

			continue;
		}

		if (depth === 1 && t.type === HmiExpr.T.OP && t.value === ',')
		{
			finish();
			arg++;

			continue;
		}

		if (depth === 1)
		{
			run.push(t);
		}
	}
};

/** The local variables a script declares, by lower-case name. */
HmiTagRefs.localsIn = function(src)
{
	if (typeof src !== 'string' || src === '')
	{
		return {};
	}

	var lex = new HmiExpr.Lexer(src).run();

	return (lex.errors.length > 0) ? {} : HmiTagRefs.scanDim(lex.tokens).locals;
};

/**
 * The tag names one field holds: fn(name) for each reference, duplicates
 * included. System tags are not reported: they cannot be replaced.
 */
HmiTagRefs.namesIn = function(value, role, fn, shield)
{
	if (role === 'tag')
	{
		var parsed = HmiTagRefs.parseName(value);

		if (parsed != null && HmiTypes.systemTag(parsed.name) == null)
		{
			fn(parsed.name);
		}

		return;
	}

	var scan = HmiTagRefs.scanText(value, (role === 'script') ? 'script' : 'expr',
		shield);

	for (var i = 0; i < scan.sites.length; i++)
	{
		if (!scan.sites[i].system)
		{
			fn(scan.sites[i].name);
		}
	}
};

// ---------------------------------------------------------------- rewriting

/**
 * Rewrites the tag names in an expression or a script.
 *
 * @param map {lowercase old name: new name}, applied as a whole: each site is
 * matched against the original text once, so nothing cascades.
 * @param shield names this text holds that are not tags, lower case: a
 * QuickFunction's arguments, which are local variables with no DIM to find
 * them by.
 * @returns {Object} {text, count, error}; with an error the text is returned
 * unchanged.
 */
HmiTagRefs.rewriteText = function(src, map, mode, shield)
{
	var scan = HmiTagRefs.scanText(src, mode, shield);

	if (scan.error != null)
	{
		return {text: src, count: 0, error: scan.error};
	}

	var edits = [];

	for (var i = 0; i < scan.sites.length; i++)
	{
		var site = scan.sites[i];
		var to = (!site.system) ? map[site.name.toLowerCase()] : null;

		if (to != null && to !== '')
		{
			edits.push({start: site.start, length: site.length,
				text: (site.kind === 'literal') ? '"' + to + '"' : to});
		}
	}

	// Back to front, so the offsets of the edits still to come stay valid.
	edits.sort(function(a, b) { return b.start - a.start; });

	var text = src;

	for (var e = 0; e < edits.length; e++)
	{
		text = text.substring(0, edits[e].start) + edits[e].text +
			text.substring(edits[e].start + edits[e].length);
	}

	return {text: text, count: edits.length, error: null};
};

/** Rewrites a bare tag-name field, keeping any qualifier and dotfield. */
HmiTagRefs.rewriteName = function(value, map)
{
	var parsed = HmiTagRefs.parseName(value);

	if (parsed == null)
	{
		return {text: value, count: 0, error: 'not a tag name'};
	}

	var to = (HmiTypes.systemTag(parsed.name) == null) ?
		map[parsed.name.toLowerCase()] : null;

	if (to == null || to === '')
	{
		return {text: value, count: 0, error: null};
	}

	return {text: parsed.prefix + to + parsed.field, count: 1, error: null};
};

/** Whether a text mentions any of the map's names, for reporting a skip. */
HmiTagRefs.mentionsAny = function(src, map)
{
	for (var lower in map)
	{
		var re = new RegExp('(^|[^A-Za-z0-9_$.])' + HmiTagRefs.escapeRe(lower) +
			'(?![A-Za-z0-9_$])', 'i');

		if (re.test(' ' + src))
		{
			return true;
		}
	}

	return false;
};

/**
 * Rewrites one cell's or holder's links in place.
 *
 * @param skipped optional array, which collects {path, link, reason} for a
 * field that names something in the map but cannot be parsed.
 * @returns {number} how many names were replaced.
 */
HmiTagRefs.rewriteLinks = function(links, map, skipped, cell)
{
	var count = 0;

	for (var key in links)
	{
		HmiTagRefs.eachField(links[key], {key: key}, function(site)
		{
			var src = site.holder[site.field];
			var res = (site.role === 'tag') ? HmiTagRefs.rewriteName(src, map) :
				HmiTagRefs.rewriteText(src, map,
					(site.role === 'script') ? 'script' : 'expr');

			if (res.error != null)
			{
				if (skipped != null && HmiTagRefs.mentionsAny(src, map))
				{
					skipped.push({cell: cell, link: key, path: site.path,
						reason: res.error});
				}

				return;
			}

			if (res.count > 0)
			{
				site.holder[site.field] = res.text;
				count += res.count;
			}
		});
	}

	return count;
};

/**
 * Applies a replacement map to a scope as one undoable edit, however many
 * cells and fields it touches.
 *
 * @returns {Object} {cells, sites, skipped}
 */
HmiTagRefs.apply = function(ui, scope, map)
{
	var graph = ui.editor.graph;
	var model = graph.getModel();
	var res = {cells: 0, sites: 0, skipped: []};

	model.beginUpdate();

	try
	{
		for (var i = 0; i < scope.cells.length; i++)
		{
			var cell = scope.cells[i];
			var links = HmiProject.getCellLinks(graph, cell);
			var n = HmiTagRefs.rewriteLinks(links, map, res.skipped, cell);

			if (n > 0)
			{
				res.cells++;
				res.sites += n;
				HmiProject.setCellLinks(graph, cell, links);
			}
		}
	}
	finally
	{
		model.endUpdate();
	}

	return res;
};

/** The sites naming one tag in a scope: [{cell, link, field, path, role}]. */
HmiTagRefs.find = function(ui, scope, name)
{
	var graph = ui.editor.graph;
	var target = ('' + name).toLowerCase();
	var found = [];

	for (var i = 0; i < scope.cells.length; i++)
	{
		HmiTagRefs.eachCellField(graph, scope.cells[i], null, function(site)
		{
			HmiTagRefs.namesIn(site.holder[site.field], site.role,
				function(used)
				{
					if (used.toLowerCase() === target)
					{
						found.push({cell: site.cell, link: site.key,
							field: site.field, path: site.path,
							role: site.role});
					}
				});
		});
	}

	return found;
};

/**
 * The tags named in a scope: [{name, uses, known, runtime}], sorted by name.
 *
 * Names are case-insensitive, so the first spelling seen stands for them all.
 * System tags are left out: they cannot be replaced.
 */
HmiTagRefs.collect = function(project, scope, graph)
{
	var rows = [];
	var index = {};

	var add = function(name)
	{
		var key = name.toLowerCase();

		if (index[key] == null)
		{
			index[key] = {name: name, uses: 0,
				known: project != null && project.getTag(name) != null,
				runtime: name.charAt(0) === '$'};
			rows.push(index[key]);
		}

		index[key].uses++;
	};

	for (var i = 0; i < scope.cells.length; i++)
	{
		HmiTagRefs.eachCellField(graph, scope.cells[i], null, function(site)
		{
			HmiTagRefs.namesIn(site.holder[site.field], site.role, add);
		});
	}

	rows.sort(function(a, b)
	{
		var x = a.name.toLowerCase();
		var y = b.name.toLowerCase();

		return (x < y) ? -1 : ((x > y) ? 1 : 0);
	});

	return rows;
};

/**
 * The tag to start a new one from: the tag it is replacing, when there is
 * one, because re-pointing a screen at the next unit wants the same kind of
 * tag. An I/O tag keeps its device but not its address, which belonged to the
 * tag being replaced.
 */
HmiTagRefs.newTagFrom = function(ui, name, template)
{
	if (template == null)
	{
		return HmiProject.createTag(name, HmiTagRefs.guessType(ui, name));
	}

	var tag = JSON.parse(JSON.stringify(template));
	tag.name = name;

	if (tag.address != null)
	{
		tag.address = '';
	}

	return tag;
};

/**
 * A sensible type for a tag that does not exist yet, from the way the current
 * page already uses the name. A guess the dialog shows for editing, not a
 * decision: an analog tag suits most links, so that is the fallback.
 */
HmiTagRefs.guessType = function(ui, name)
{
	var graph = ui.editor.graph;
	var target = ('' + name).toLowerCase();
	var guess = null;

	var cells = HmiTagRefs.pageCells(graph);

	for (var i = 0; i < cells.length && guess == null; i++)
	{
		HmiTagRefs.eachCellField(graph, cells[i], {roles: ['tag']},
			function(site)
		{
			var parsed = HmiTagRefs.parseName(site.holder[site.field]);

			if (guess != null || parsed == null ||
				parsed.name.toLowerCase() !== target)
			{
				return;
			}

			var cfg = site.links[site.key];

			if (site.key === 'pushbutton' ||
				site.key.indexOf('discreteAlarm') > 0)
			{
				guess = (cfg.kind === 'string') ? 'MemoryMessage' :
					((cfg.kind === 'analog') ? 'MemoryReal' : 'MemoryDiscrete');
			}
			else if (site.key === 'userInput')
			{
				guess = (cfg.kind === 'discrete') ? 'MemoryDiscrete' :
					((cfg.kind === 'string') ? 'MemoryMessage' : 'MemoryReal');
			}
		});
	}

	return (guess != null) ? guess : 'MemoryReal';
};

// --------------------------------------------------- the whole project

/**
 * Every script and tag field the project holds outside its cells: the window
 * scripts, the application scripts and the recipe books.
 *
 * fn({holder, field, role, path, apply}) -- holder[field] is the text, and a
 * recipe book's value map needs its keys re-keyed rather than a field
 * written, which is what apply is for.
 */
HmiTagRefs.eachProjectField = function(project, fn)
{
	if (project == null)
	{
		return;
	}

	var scripts = HmiProject.WINDOW_SCRIPTS.concat(['everyMs']);

	for (var pageId in project.windows)
	{
		var w = project.windows[pageId];

		for (var i = 0; i < scripts.length; i++)
		{
			var field = scripts[i];

			if (typeof w[field] === 'string' && w[field] !== '')
			{
				fn({holder: w, field: field,
					role: (field === 'everyMs') ? 'expr' : 'script',
					path: 'window ' + pageId + ' ' + field});
			}
		}
	}

	var app = (project.settings != null) ? project.settings.scripts : null;
	var appScripts = HmiProject.APP_SCRIPTS.concat(['everyMs']);

	for (var a = 0; app != null && a < appScripts.length; a++)
	{
		var key = appScripts[a];

		if (typeof app[key] === 'string' && app[key] !== '')
		{
			fn({holder: app, field: key,
				role: (key === 'everyMs') ? 'expr' : 'script',
				path: 'application ' + key});
		}
	}

	var books = project.recipeBooks || [];

	for (var b = 0; b < books.length; b++)
	{
		var book = books[b];

		for (var it = 0; book.items != null && it < book.items.length; it++)
		{
			var item = book.items[it];
			var fields = ['tag', 'ioTag'];

			for (var f = 0; f < fields.length; f++)
			{
				if (typeof item[fields[f]] === 'string' && item[fields[f]] !== '')
				{
					fn({holder: item, field: fields[f], role: 'tag',
						path: 'recipe book "' + book.name + '" ' + fields[f]});
				}
			}
		}

		// A saved recipe's values are keyed by the tag they belong to.
		var recipes = book.recipes || {};

		for (var name in recipes)
		{
			fn({holder: recipes, field: name, role: 'keys',
				path: 'recipe "' + name + '" in "' + book.name + '"'});
		}
	}

	var fns = (project.quickFunctions != null) ? project.quickFunctions : [];

	for (var q = 0; q < fns.length; q++)
	{
		if (typeof fns[q].body === 'string' && fns[q].body !== '')
		{
			fn({holder: fns[q], field: 'body', role: 'script',
				path: 'QuickFunction "' + fns[q].name + '"',
				shield: HmiQuickFn.argKeys(fns[q])});
		}
	}
};

/** Re-keys a recipe's values. Returns how many keys moved. */
HmiTagRefs.rekey = function(values, map)
{
	var moved = 0;
	var next = {};

	for (var tag in values)
	{
		var to = map[tag.toLowerCase()];

		if (to != null && to !== '' && HmiTypes.systemTag(tag) == null)
		{
			next[to] = values[tag];
			moved++;
		}
		else
		{
			next[tag] = values[tag];
		}
	}

	if (moved > 0)
	{
		for (var key in values)
		{
			delete values[key];
		}

		for (var k in next)
		{
			values[k] = next[k];
		}
	}

	return moved;
};

/**
 * Every site in the whole project that can name a tag: the cells of every
 * page, the window and application scripts, and the recipe books. Read only,
 * which is why other pages are reached the way HmiTrend.collect reaches them.
 *
 * fn({holder, field, role, path, key, cell, page})
 */
HmiTagRefs.eachProjectSite = function(ui, fn)
{
	var graph = ui.editor.graph;
	var page = (ui.currentPage != null) ? ui.currentPage : null;
	var cells = HmiTagRefs.pageCells(graph);

	for (var i = 0; i < cells.length; i++)
	{
		HmiTagRefs.eachCellField(graph, cells[i], null, function(site)
		{
			site.page = page;
			fn(site);
		});
	}

	for (var p = 0; ui.pages != null && p < ui.pages.length; p++)
	{
		var other = ui.pages[p];

		if (other === ui.currentPage)
		{
			continue;
		}

		HmiLog.guard('tagRefs.pageRoot', function() { ui.updatePageRoot(other); });

		if (other.root == null)
		{
			continue;
		}

		var walk = function(cell, onPage)
		{
			var links = HmiTagRefs.rawLinks(cell);

			for (var key in links)
			{
				HmiTagRefs.eachLinkField(links[key], key, null, cell, links,
					function(site)
				{
					site.page = onPage;
					fn(site);
				});
			}

			for (var c = 0; cell.children != null && c < cell.children.length; c++)
			{
				walk(cell.children[c], onPage);
			}
		};

		walk(other.root, other);
	}

	HmiTagRefs.eachProjectField(ui.hmiProject, function(site)
	{
		site.cell = null;
		site.page = null;
		fn(site);
	});
};

/**
 * Every site in the project that names one tag: [{cell, link, field, path,
 * page}]. What the Tag Dictionary counts before deleting a tag.
 */
HmiTagRefs.findInProject = function(ui, name)
{
	var target = ('' + name).toLowerCase();
	var found = [];

	HmiTagRefs.eachProjectSite(ui, function(site)
	{
		if (site.role === 'keys')
		{
			if (site.field.toLowerCase() === target)
			{
				found.push({cell: null, link: site.path, field: site.field,
					path: site.path, page: null});
			}

			return;
		}

		HmiTagRefs.namesIn(site.holder[site.field], site.role, function(used)
		{
			if (used.toLowerCase() === target)
			{
				found.push({cell: site.cell, link: (site.key != null) ? site.key : site.path,
					field: site.field, path: site.path, page: site.page});
			}
		}, site.shield);
	});

	return found;
};

/** A cell's links without a graph, for a page that is not the current one. */
HmiTagRefs.rawLinks = function(cell)
{
	if (cell == null || cell.value == null ||
		typeof cell.value.getAttribute !== 'function')
	{
		return null;
	}

	try
	{
		var raw = cell.value.getAttribute(HmiProject.CELL_ATTRIBUTE);
		var data = (raw) ? JSON.parse(raw) : null;

		return (data != null && data.links != null) ? data.links : null;
	}
	catch (e)
	{
		return null;
	}
};

HmiTagRefs.setRawLinks = function(cell, links)
{
	cell.value.setAttribute(HmiProject.CELL_ATTRIBUTE,
		JSON.stringify({v: HmiProject.FORMAT_VERSION, links: links}));
};

/**
 * Applies a replacement map to the whole project, which is what a tag rename
 * needs.
 *
 * The current page goes through the model, so that part is one undoable edit.
 * Cells on other pages are not in the model and are written to the page's own
 * root, and the project's scripts and recipe books are not model state
 * either, so neither can be undone -- the caller says so.
 *
 * @returns {Object} {sites, cells, pages, project, skipped}
 */
HmiTagRefs.rename = function(ui, map)
{
	var graph = ui.editor.graph;
	var project = ui.hmiProject;
	var res = {sites: 0, cells: 0, pages: 0, project: 0, skipped: []};

	var here = HmiTagRefs.apply(ui, {cells: HmiTagRefs.pageCells(graph)}, map);
	res.sites += here.sites;
	res.cells += here.cells;
	res.skipped = res.skipped.concat(here.skipped);

	for (var p = 0; ui.pages != null && p < ui.pages.length; p++)
	{
		var page = ui.pages[p];

		if (page === ui.currentPage)
		{
			continue;
		}

		HmiLog.guard('tagRefs.pageRoot', function() { ui.updatePageRoot(page); });

		if (page.root == null)
		{
			continue;
		}

		var touched = 0;

		var walk = function(cell)
		{
			var links = HmiTagRefs.rawLinks(cell);

			if (links != null)
			{
				var n = HmiTagRefs.rewriteLinks(links, map, res.skipped, cell);

				if (n > 0)
				{
					HmiTagRefs.setRawLinks(cell, links);
					touched += n;
					res.cells++;
				}
			}

			for (var i = 0; cell.children != null && i < cell.children.length; i++)
			{
				walk(cell.children[i]);
			}
		};

		walk(page.root);

		if (touched > 0)
		{
			res.sites += touched;
			res.pages++;
			// Without this the page is saved from its old XML, not its root.
			page.needsUpdate = true;
		}
	}

	HmiTagRefs.eachProjectField(project, function(site)
	{
		if (site.role === 'keys')
		{
			res.project += HmiTagRefs.rekey(site.holder[site.field], map);

			return;
		}

		var src = site.holder[site.field];
		var out = (site.role === 'tag') ? HmiTagRefs.rewriteName(src, map) :
			HmiTagRefs.rewriteText(src, map,
				(site.role === 'script') ? 'script' : 'expr', site.shield);

		if (out.error != null)
		{
			if (HmiTagRefs.mentionsAny(src, map))
			{
				res.skipped.push({cell: null, link: site.path,
					path: site.path, reason: out.error});
			}

			return;
		}

		if (out.count > 0)
		{
			site.holder[site.field] = out.text;
			res.project += out.count;
		}
	});

	res.sites += res.project;

	if (res.sites > 0 && project != null)
	{
		project.touch();
		HmiFile.markModified(ui);
	}

	return res;
};
