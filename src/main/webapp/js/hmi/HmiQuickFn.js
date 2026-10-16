/**
 * QuickFunctions: functions an engineer defines in the project.
 *
 * Each has a name, typed arguments and a script body that gives a value back
 * with Return. They are called like any other function, from a script or from
 * an animation expression -- except that a function which writes a tag or
 * calls an action function can only be called from a script, exactly as those
 * functions themselves can.
 *
 * This file owns the data, the name rules and the one checker the dialog, the
 * command line and Validate all call, so none of them can disagree. The
 * language itself is in HmiExpr.
 */
HmiQuickFn = function() {};

/** Arguments per function. More than this is a design to rethink, not a list. */
HmiQuickFn.MAX_ARGS = 8;

/**
 * Run-time caps. Recursion is refused when the project is checked, so these
 * are the backstop for a call graph that grew past what anyone intended: the
 * evaluator has no stack of its own to run out of before the browser's.
 */
HmiQuickFn.MAX_DEPTH = 16;
HmiQuickFn.MAX_CALLS = 2000;

/** The argument types, which are the script language's local variable types. */
HmiQuickFn.TYPES = ['Analog', 'Discrete', 'Message'];

HmiQuickFn.normalizeType = function(type)
{
	var canonical = (type != null) ?
		HmiExpr.LOCAL_TYPES[('' + type).toLowerCase()] : null;

	return (canonical != null) ? canonical : 'Analog';
};

HmiQuickFn.newFunction = function(name)
{
	return {name: name, args: [], body: ''};
};

HmiQuickFn.copy = function(list)
{
	return JSON.parse(JSON.stringify(list || []));
};

HmiQuickFn.listOf = function(project)
{
	return (project != null && project.quickFunctions != null) ?
		project.quickFunctions : [];
};

/** The function of this name, whatever its case, or null. */
HmiQuickFn.find = function(list, name)
{
	if (typeof name !== 'string')
	{
		return null;
	}

	var key = name.toLowerCase();

	for (var i = 0; list != null && i < list.length; i++)
	{
		if (('' + list[i].name).toLowerCase() === key)
		{
			return list[i];
		}
	}

	return null;
};

/** "Scaled(Raw, Span)", for the list of functions. */
HmiQuickFn.signature = function(fn)
{
	var names = [];

	for (var i = 0; fn.args != null && i < fn.args.length; i++)
	{
		names.push(fn.args[i].name);
	}

	return fn.name + '(' + names.join(', ') + ')';
};

/** The argument names, lower case, for shielding them from a tag rename. */
HmiQuickFn.argKeys = function(fn)
{
	var keys = {};

	for (var i = 0; fn != null && fn.args != null && i < fn.args.length; i++)
	{
		if (fn.args[i].name)
		{
			keys[('' + fn.args[i].name).toLowerCase()] = true;
		}
	}

	return keys;
};

/**
 * The argument list as text. The compile cache is keyed on the body's text,
 * which does not change when an argument is renamed, so the key carries this
 * too -- the dialog compiles a draft body against a draft argument list.
 */
HmiQuickFn.argsKey = function(fn)
{
	var parts = [];

	for (var i = 0; fn != null && fn.args != null && i < fn.args.length; i++)
	{
		parts.push(('' + fn.args[i].name).toLowerCase() + ':' +
			HmiQuickFn.normalizeType(fn.args[i].type));
	}

	return parts.join(',');
};

// ------------------------------------------------------------- compiling

/** Compiles ahead of time, and re-entry would mean an undetected cycle. */
HmiQuickFn.compiling = {};

/**
 * A function's compiled body: HmiExpr's record, with `impure` saying whether
 * it writes a tag or calls an action function.
 *
 * Compilation goes through HmiExpr.compile so there is one cache with one
 * rule for emptying it: the project's revision. A second cache here would be
 * a second way to serve a stale function.
 */
HmiQuickFn.compile = function(project, fn)
{
	if (fn == null)
	{
		return null;
	}

	var key = ('' + fn.name).toLowerCase();

	// A cycle is refused before this, so re-entry means the prescan and the
	// parser disagree. An error is a far better outcome than a hung editor.
	if (HmiQuickFn.compiling[key])
	{
		return {src: fn.body, ast: null, deps: [], writes: [], impure: false,
			args: fn.args || [], errors: [{message: 'QuickFunction "' +
				fn.name + '" calls itself, directly or through another function',
				start: 0, length: 1}]};
	}

	HmiQuickFn.compiling[key] = true;

	try
	{
		return HmiExpr.compile(fn.body || '', {project: project, mode: 'quick',
			fn: fn});
	}
	finally
	{
		delete HmiQuickFn.compiling[key];
	}
};

HmiQuickFn.compileByName = function(project, name)
{
	return HmiQuickFn.compile(project,
		HmiQuickFn.find(HmiQuickFn.listOf(project), name));
};

/** The dialog's live check: this text as the body, with the arguments shown. */
HmiQuickFn.compileText = function(project, fn, text)
{
	return HmiQuickFn.compile(project, {name: fn.name, args: fn.args,
		body: ('' + text)});
};

// ------------------------------------------------------------- recursion

/**
 * Which QuickFunctions each one calls, from the lexer alone.
 *
 * Reading the calls without the parser is what makes cycle detection safe:
 * compiling a body to find its calls would be the very recursion this is
 * looking for. In this grammar a name followed by ( is always a call, so the
 * edges are exact, and a body with an error elsewhere still gives them up.
 */
HmiQuickFn.callGraph = function(list)
{
	var graph = {};
	var known = {};

	for (var i = 0; i < list.length; i++)
	{
		known[('' + list[i].name).toLowerCase()] = true;
	}

	for (var i = 0; i < list.length; i++)
	{
		var from = ('' + list[i].name).toLowerCase();
		var edges = graph[from] || [];
		var lex = new HmiExpr.Lexer(list[i].body || '').run();

		for (var t = 0; t < lex.tokens.length; t++)
		{
			var token = lex.tokens[t];
			var next = lex.tokens[t + 1];

			if (token.type !== HmiExpr.T.IDENT || next == null ||
				next.type !== HmiExpr.T.OP || next.value !== '(')
			{
				continue;
			}

			var to = ('' + token.value).toLowerCase();

			if (known[to] && mxUtils.indexOf(edges, to) < 0)
			{
				edges.push(to);
			}
		}

		graph[from] = edges;
	}

	return graph;
};

/** Every function that is part of a cycle, by lower-case name. */
HmiQuickFn.cycles = function(list)
{
	var graph = HmiQuickFn.callGraph(list);
	var bad = {};
	var state = {};

	var walk = function(name, stack)
	{
		if (state[name] === 'done')
		{
			return;
		}

		if (state[name] === 'open')
		{
			// Everything from where this name first appeared is in the cycle
			for (var i = mxUtils.indexOf(stack, name); i >= 0 && i < stack.length; i++)
			{
				bad[stack[i]] = true;
			}

			return;
		}

		state[name] = 'open';
		stack.push(name);
		var edges = graph[name] || [];

		for (var e = 0; e < edges.length; e++)
		{
			walk(edges[e], stack);
		}

		stack.pop();
		state[name] = 'done';
	};

	for (var key in graph)
	{
		walk(key, []);
	}

	return bad;
};

/** The cycle set for a project, worked out once per revision. */
HmiQuickFn.cycleSet = function(project)
{
	var list = HmiQuickFn.listOf(project);

	if (project == null)
	{
		return HmiQuickFn.cycles(list);
	}

	var key = project.uid + '#' + project.revision;

	if (HmiQuickFn.cycleCache == null || HmiQuickFn.cycleCache.key !== key)
	{
		HmiQuickFn.cycleCache = {key: key, set: HmiQuickFn.cycles(list)};
	}

	return HmiQuickFn.cycleCache.set;
};

HmiQuickFn.inCycle = function(project, name)
{
	return HmiQuickFn.cycleSet(project)[('' + name).toLowerCase()] === true;
};

// ----------------------------------------------------------- name rules

/**
 * Why this name cannot be a QuickFunction's or an argument's, or null.
 *
 * A name has to mean one thing: the body of a function sees arguments, tags
 * and system tags in the same place, so a name that is two of those is a trap
 * rather than a convenience. This is the rule parseDim already applies to a
 * script's local variables, for the same reason.
 */
HmiQuickFn.checkName = function(project, name, what)
{
	if (name == null || ('' + name).trim() === '')
	{
		return what + ' needs a name.';
	}

	name = '' + name;

	if (!HmiTagRefs.validName(name))
	{
		return what + ' names start with a letter or _ and may contain ' +
			'letters, digits and _ (at most ' + HmiExpr.MAX_NAME +
			' characters).';
	}

	if (name.charAt(0) === '$')
	{
		return what + ' names cannot start with $.';
	}

	var upper = name.toUpperCase();

	if (HmiExpr.WORD_OPS[upper] != null || upper === 'DIM' || upper === 'AS' ||
		upper === 'RETURN')
	{
		return '"' + name + '" is a keyword.';
	}

	if (HmiExpr.LOCAL_TYPES[name.toLowerCase()] != null)
	{
		return '"' + name + '" is a type name.';
	}

	if (HmiTypes.systemTag(name) != null)
	{
		return '"' + name + '" is a system tag name.';
	}

	if (project != null && project.getTag(name) != null)
	{
		return '"' + name + '" is the name of a tag.';
	}

	return null;
};

/** Why this function's name and arguments cannot be used, or null. */
HmiQuickFn.nameProblem = function(project, list, fn)
{
	var problem = HmiQuickFn.checkName(project, fn.name, 'A QuickFunction');

	if (problem != null)
	{
		return problem;
	}

	for (var key in HmiExpr.FUNCTIONS)
	{
		if (key.toLowerCase() === ('' + fn.name).toLowerCase())
		{
			return '"' + fn.name + '" is the name of a built-in function.';
		}
	}

	for (var i = 0; list != null && i < list.length; i++)
	{
		if (list[i] !== fn &&
			('' + list[i].name).toLowerCase() === ('' + fn.name).toLowerCase())
		{
			return 'There are two QuickFunctions named "' + fn.name + '".';
		}
	}

	var args = fn.args || [];

	if (args.length > HmiQuickFn.MAX_ARGS)
	{
		return 'A QuickFunction takes at most ' + HmiQuickFn.MAX_ARGS +
			' arguments.';
	}

	var seen = {};

	for (var a = 0; a < args.length; a++)
	{
		problem = HmiQuickFn.checkName(project, args[a].name, 'An argument');

		if (problem != null)
		{
			return problem;
		}

		var lower = ('' + args[a].name).toLowerCase();

		if (seen[lower])
		{
			return '"' + fn.name + '" has two arguments named "' +
				args[a].name + '".';
		}

		seen[lower] = true;
	}

	return null;
};

/** Everything wrong with one function, as messages. */
HmiQuickFn.problems = function(project, list, fn)
{
	var problems = [];
	var named = HmiQuickFn.nameProblem(project, list, fn);

	if (named != null)
	{
		problems.push(named);

		// Its body is compiled against a name that cannot be used, so
		// anything it says about it would be noise.
		return problems;
	}

	if (HmiQuickFn.inCycle(project, fn.name))
	{
		problems.push('"' + fn.name + '" calls itself, directly or through ' +
			'another QuickFunction.');

		return problems;
	}

	var compiled = HmiQuickFn.compile(project, fn);

	for (var i = 0; i < compiled.errors.length; i++)
	{
		problems.push(compiled.errors[i].message);
	}

	if (problems.length === 0 && !HmiQuickFn.hasReturn(compiled.ast))
	{
		problems.push('"' + fn.name + '" has no Return statement, so it ' +
			'always gives 0.');
	}

	return problems;
};

/** Whether a compiled body returns anywhere at all. */
HmiQuickFn.hasReturn = function(ast)
{
	if (ast == null || typeof ast !== 'object')
	{
		return false;
	}

	if (ast.type === 'return')
	{
		return true;
	}

	for (var key in ast)
	{
		var child = ast[key];

		if (child != null && typeof child === 'object' &&
			HmiQuickFn.hasReturn(child))
		{
			return true;
		}
	}

	return false;
};

/**
 * A stand-in project for the dialog, which edits a copy: the body being typed
 * has to see the draft functions and the draft arguments, while tags still
 * come from the real dictionary. Its own uid and revision keep its compiles
 * out of the real project's.
 */
HmiQuickFn.draftScope = function(project, list)
{
	var scope = {
		uid: ((project != null) ? project.uid : 'p0') + 'draft',
		revision: 0,
		quickFunctions: list,
		getTag: function(name)
		{
			return (project != null) ? project.getTag(name) : null;
		},
		getDevice: function(name)
		{
			return (project != null) ? project.getDevice(name) : null;
		},
		touch: function()
		{
			this.revision++;
		}
	};

	scope.recipeBooks = (project != null) ? project.recipeBooks : [];
	scope.settings = (project != null) ? project.settings : null;
	scope.tags = (project != null) ? project.tags : [];

	return scope;
};
