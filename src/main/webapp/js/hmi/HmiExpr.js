/**
 * The expression engine.
 *
 * A hand-written lexer, precedence-climbing parser and tree-walking evaluator
 * for the InTouch QuickScript subset. Purpose-built rather than borrowed: the
 * drawio webapp has no module system, so an npm parser would cost more
 * integration than this costs to write, and the two things that actually
 * matter here -- validating against the tag dictionary at design time, and
 * propagating quality and timestamp through every operator -- are not features
 * a general expression library has.
 *
 * Every value carried through evaluation is a triple:
 *
 *     {value, quality, timestamp}
 *
 * Quality is the MINIMUM across an expression's operands and timestamp the
 * MAXIMUM, so a single bad input makes the whole result bad. That is what lets
 * a link show its bad-quality treatment instead of a plausible-looking lie.
 */
HmiExpr = function() {};

// ----------------------------------------------------------------- tokens

HmiExpr.T = {
	NUMBER: 'number', STRING: 'string', IDENT: 'ident', OP: 'op', END: 'end'
};

/**
 * Words that are operators or keywords, matched case-insensitively on a whole
 * token. Reclassification happens after an identifier has been lexed greedily,
 * so a tag named Android or Ifac is unaffected.
 */
HmiExpr.WORD_OPS = {AND: 'AND', OR: 'OR', NOT: 'NOT', MOD: 'MOD',
	IF: 'IF', THEN: 'THEN', ELSE: 'ELSE', ENDIF: 'ENDIF'};

/**
 * The loop keywords, which are deliberately NOT word operators.
 *
 *     FOR <tag or variable> = <start> TO <end> [STEP <by>] ... NEXT
 *     WHILE <condition> ... ENDWHILE
 *
 * Step and Next are names a plant project really does give a tag -- a batch
 * step, a Next button -- and a word operator would stop such a tag compiling
 * anywhere in the project, animation links included. So these words are
 * recognized by position instead, the way DIM and Return are: HmiExpr.loopWords
 * classifies the tokens once, and both the parser and the tag rename scanner
 * (HmiTagRefs.scanText) read that one answer, so they cannot disagree about
 * which STEP is a keyword and which is a tag.
 */
HmiExpr.LOOP_WORDS = {FOR: 'FOR', TO: 'TO', STEP: 'STEP', NEXT: 'NEXT',
	WHILE: 'WHILE', ENDWHILE: 'ENDWHILE'};

/**
 * Operators after which a value has to come, so a loop word standing there is
 * a tag of that name and nothing else. THEN is not one of them: a statement
 * begins after it, which is where a loop may.
 */
HmiExpr.VALUE_WANTED = {'=': 1, '+': 1, '-': 1, '*': 1, '/': 1, '**': 1,
	'==': 1, '<>': 1, '<=': 1, '>=': 1, '<': 1, '>': 1, '(': 1, ',': 1,
	'.': 1, ':': 1, 'AND': 1, 'OR': 1, 'NOT': 1, 'MOD': 1, 'IF': 1};

/**
 * How many passes all the loops in one run of a script may take together.
 *
 * A single number bounds the whole run, so nested loops cannot multiply their
 * way into a hang; the Run reports a script error instead, the way the
 * QuickFunction depth and call caps do. It has to clear the largest result set
 * a SELECT can return (HmiSql.maxRows), since walking one with
 * WHILE SQLNext(...) == 0 is exactly what loops are here for.
 */
HmiExpr.MAX_ITERATIONS = 100000;

/** Tag names are limited to 63 characters, as in InTouch. */
HmiExpr.MAX_NAME = 63;

/**
 * Modes whose source is statements rather than one expression: a script, and
 * a QuickFunction's body (HmiQuickFn), which is a script with arguments and
 * Return. Everything a script may do and an animation link may not -- assign
 * a tag, declare a local, call an action function -- is gated on this.
 */
HmiExpr.STATEMENT_MODES = {'script': true, 'quick': true};

HmiExpr.isStatements = function(mode)
{
	return HmiExpr.STATEMENT_MODES[mode] === true;
};

/**
 * Local variables: DIM name[, name ...] AS Analog | Discrete | Message; in a
 * script. They live while the script runs, start at 0 or "", and may not share
 * a name with a tag. DIM and AS are words only in that statement, so a tag
 * named As is still a tag everywhere else.
 */
HmiExpr.LOCAL_TYPES = {analog: 'Analog', discrete: 'Discrete', message: 'Message'};

/** A local variable's starting value. */
HmiExpr.localDefault = function(type)
{
	return (type === 'Message') ? '' : 0;
};

/** A value as a local variable of this type holds it. */
HmiExpr.coerceLocal = function(type, value)
{
	if (value == null)
	{
		return HmiExpr.localDefault(type);
	}

	if (type === 'Message')
	{
		return HmiExpr.text(value);
	}

	if (type === 'Discrete')
	{
		return (HmiExpr.truthy(value)) ? 1 : 0;
	}

	return HmiExpr.num(value);
};

/**
 * A number of characters: whole, and never below zero. A count that runs past
 * the end of the text simply stops there.
 */
HmiExpr.count = function(v)
{
	return Math.max(0, Math.trunc(HmiExpr.num(v)));
};

/**
 * The number some text holds, or 0 when it holds none. Unlike HmiExpr.num,
 * which refuses what is not a number, this is what StringToIntg and
 * StringToReal are for: an operator's typing reaches them, and a script that
 * stopped on every stray character would be unusable.
 */
HmiExpr.looseNum = function(v)
{
	if (typeof v === 'number')
	{
		return v;
	}

	var n = parseFloat(HmiExpr.text(v));

	return (isNaN(n)) ? 0 : n;
};

/**
 * Built-in functions. Each takes already-evaluated plain values and returns a
 * plain value; quality and timestamp are combined by the caller.
 */
HmiExpr.FUNCTIONS = {
	'Abs': {arity: 1, fn: function(a) { return Math.abs(HmiExpr.num(a)); }},
	'Sqrt': {arity: 1, fn: function(a) { return Math.sqrt(HmiExpr.num(a)); }},
	'Int': {arity: 1, fn: function(a) { return Math.trunc(HmiExpr.num(a)); }},
	'Round': {arity: 1, fn: function(a) { return Math.round(HmiExpr.num(a)); }},
	'Min': {arity: 2, fn: function(a, b) { return Math.min(HmiExpr.num(a), HmiExpr.num(b)); }},
	'Max': {arity: 2, fn: function(a, b) { return Math.max(HmiExpr.num(a), HmiExpr.num(b)); }},
	'Sqr': {arity: 1, fn: function(a) { return HmiExpr.num(a) * HmiExpr.num(a); }},
	'StringLen': {arity: 1, fn: function(a) { return ('' + a).length; }},
	'Text': {arity: 2, fn: function(a, b) { return HmiExpr.picture(HmiExpr.num(a), '' + b); }},

	// Text. A character position counts from 1, as it reads on the page, and
	// a number given where text is expected is used as it would show.
	'StringLeft': {arity: 2, fn: function(a, b)
	{
		return HmiExpr.text(a).substring(0, HmiExpr.count(b));
	}},
	'StringRight': {arity: 2, fn: function(a, b)
	{
		var text = HmiExpr.text(a);

		return text.substring(Math.max(0, text.length - HmiExpr.count(b)));
	}},
	'StringMid': {arity: 3, fn: function(a, b, c)
	{
		var from = Math.max(1, Math.trunc(HmiExpr.num(b))) - 1;

		return HmiExpr.text(a).substring(from, from + HmiExpr.count(c));
	}},
	'StringTrim': {arity: 1, fn: function(a)
	{
		return HmiExpr.text(a).replace(/^\s+|\s+$/g, '');
	}},
	'StringUpper': {arity: 1, fn: function(a) { return HmiExpr.text(a).toUpperCase(); }},
	'StringLower': {arity: 1, fn: function(a) { return HmiExpr.text(a).toLowerCase(); }},
	// Where it starts, counting from 1, or 0 when it is not there at all
	'StringInString': {arity: 2, fn: function(a, b)
	{
		return HmiExpr.text(a).indexOf(HmiExpr.text(b)) + 1;
	}},
	// Every occurrence, not just the first. Nothing to look for changes nothing.
	'StringReplace': {arity: 3, fn: function(a, b, c)
	{
		var text = HmiExpr.text(a);
		var find = HmiExpr.text(b);

		return (find === '') ? text : text.split(find).join(HmiExpr.text(c));
	}},
	// StringFromIntg(255, 16) is "ff"; StringUpper around it if "FF" is wanted
	'StringFromIntg': {minArity: 1, maxArity: 2, fn: function(a, b)
	{
		var base = (b == null) ? 10 : Math.trunc(HmiExpr.num(b));

		if (base < 2 || base > 36)
		{
			throw new HmiExpr.RuntimeError('StringFromIntg: the base must be 2 to 36');
		}

		return Math.trunc(HmiExpr.num(a)).toString(base);
	}},
	/*
	 * StringFromReal(value, decimals[, kind]): "f" is a plain number (the
	 * default), "e" is exponential, and "g" is the shorter of the two with
	 * the trailing zeros dropped, decimals counting significant digits.
	 */
	'StringFromReal': {minArity: 2, maxArity: 3, fn: function(a, b, c)
	{
		var n = HmiExpr.num(a);
		var places = Math.min(100, HmiExpr.count(b));
		var kind = (c == null) ? 'f' : HmiExpr.text(c).toLowerCase();

		if (kind === 'e')
		{
			return n.toExponential(places);
		}

		if (kind === 'g')
		{
			return '' + parseFloat(n.toPrecision(Math.max(1, places)));
		}

		return n.toFixed(places);
	}},
	'StringToIntg': {arity: 1, fn: function(a) { return Math.trunc(HmiExpr.looseNum(a)); }},
	'StringToReal': {arity: 1, fn: function(a) { return HmiExpr.looseNum(a); }},

	// Actions, for scripts only: they run through the runtime (ctx.call) and
	// have effects, so an expression re-evaluated on every change must not
	// call them
	'ShowLogin': {arity: 0, action: true},
	'Login': {arity: 2, action: true},
	'Logout': {arity: 0, action: true},
	'ChangePassword': {arity: 2, action: true},
	'ShowUserManager': {arity: 0, action: true},

	// Recipes (HmiRecipes.js). ShowRecipeSelect is asynchronous: the script
	// pauses at it until the operator closes the window (Evaluator.resume)
	'RecipeSave': {arity: 2, action: true},
	'RecipeLoad': {arity: 2, action: true},
	'RecipeUpload': {arity: 2, action: true},
	'RecipeDownload': {arity: 2, action: true},
	'RecipeExport': {arity: 2, action: true},
	'RecipeImport': {arity: 2, action: true},
	'RecipeDelete': {minArity: 2, maxArity: 3, action: true},
	'RecipeRename': {arity: 3, action: true},
	'ShowRecipeSelect': {minArity: 1, maxArity: 5, action: true, async: true},

	// Indirect tags (HmiIndirect.js): LinkIndirectTag("Indirect", "Tag")
	'LinkIndirectTag': {arity: 2, action: true},

	// ShowWindow(name[, left, top[, modal[, wait]]]) (HmiWindows.js). With
	// wait, the script pauses until the window closes; otherwise it carries on
	'ShowWindow': {minArity: 1, maxArity: 5, action: true, async: true},

	// ScreenToPDF() (HmiScreenPdf.js): like RecipeExport, returns 1 once the
	// Save dialog is on its way; the script does not wait for it
	'ScreenToPDF': {arity: 0, action: true},

	// SQL databases (HmiSql.js). The ones that reach a database are
	// asynchronous, which is exactly the call form they are written in:
	// ResultCode = SQLSelect(...). The results table and its cursor live in
	// the runtime, so moving through a selection costs nothing and the rest
	// are ordinary actions.
	//
	// SQLConnect's first argument is the tag that receives the connection
	// number, so it is named rather than read: tagArgs says which arguments
	// are tags to be written instead of values to be read.
	'SQLConnect': {arity: 2, action: true, async: true, tagArgs: [0]},
	'SQLDisconnect': {arity: 1, action: true, async: true},
	'SQLSelect': {arity: 5, action: true, async: true},
	'SQLFirst': {arity: 1, action: true},
	'SQLNext': {arity: 1, action: true},
	'SQLPrev': {arity: 1, action: true},
	'SQLLast': {arity: 1, action: true},
	'SQLGetRecord': {arity: 2, action: true},
	'SQLNumRows': {arity: 1, action: true},
	'SQLEnd': {arity: 1, action: true},
	'SQLErrorMsg': {arity: 1, action: true},
	'SQLInsert': {arity: 3, action: true, async: true},
	'SQLUpdate': {arity: 4, action: true, async: true},
	'SQLUpdateCurrent': {arity: 1, action: true, async: true},
	'SQLDelete': {arity: 3, action: true, async: true},
	'SQLClearTable': {arity: 2, action: true, async: true},
	'SQLCreateTable': {arity: 3, action: true, async: true},
	'SQLDropTable': {arity: 2, action: true, async: true},

	// A statement a script builds for itself, and the prepared form of one.
	// Building it, preparing it and filling in its parameters all happen
	// here, so only running it reaches a database; the statement number
	// SQLPrepareStatement and SQLInsertPrepare hand back goes into a tag, as
	// SQLConnect's connection number does.
	//
	// The advisory arguments of the legacy call forms -- a character
	// parameter's MaxLength, a decimal's Precision and Scale -- are accepted
	// and may be left off, because a bound parameter needs none of them.
	'SQLSetStatement': {arity: 2, action: true},
	'SQLAppendStatement': {arity: 2, action: true},
	'SQLLoadStatement': {arity: 2, action: true},
	'SQLPrepareStatement': {arity: 2, action: true, tagArgs: [1]},
	'SQLSetParamChar': {minArity: 3, maxArity: 4, action: true},
	'SQLSetParamDate': {arity: 3, action: true},
	'SQLSetParamDateTime': {minArity: 3, maxArity: 4, action: true},
	'SQLSetParamDecimal': {minArity: 3, maxArity: 5, action: true},
	'SQLSetParamFloat': {arity: 3, action: true},
	'SQLSetParamInt': {arity: 3, action: true},
	'SQLSetParamLong': {arity: 3, action: true},
	'SQLSetParamNull': {minArity: 3, maxArity: 5, action: true},
	'SQLSetParamTime': {arity: 3, action: true},
	'SQLClearParam': {arity: 2, action: true},
	'SQLExecute': {arity: 3, action: true, async: true},
	'SQLClearStatement': {arity: 2, action: true},
	'SQLInsertPrepare': {arity: 4, action: true, tagArgs: [3]},
	'SQLInsertExecute': {arity: 3, action: true, async: true},
	'SQLInsertEnd': {arity: 2, action: true},
	'SQLTransact': {arity: 1, action: true, async: true},
	'SQLCommit': {arity: 1, action: true, async: true},
	'SQLRollback': {arity: 1, action: true, async: true},

	// Trends (HmiTrend.js), by the trend's name; TrendSetPen also takes the
	// pen's tag name. Names are text: literals or message tags
	'TrendSetPen': {arity: 2, action: true},
	'TrendPause': {arity: 1, action: true},
	'TrendPlay': {arity: 1, action: true},
	'TrendScrollBack': {arity: 1, action: true},
	'TrendScrollForward': {arity: 1, action: true},

	// List Boxes (HmiList.js), by the list's name. The item, the comma
	// separated text and the sort order are text too
	'ListClear': {arity: 1, action: true},
	'ListAdd': {arity: 2, action: true},
	'ListRemove': {arity: 2, action: true},
	'ListSelect': {arity: 2, action: true},
	'ListLoad': {arity: 2, action: true},
	'ListSort': {arity: 2, action: true}
};

/** A function's accepted argument counts. */
HmiExpr.arityOf = function(def)
{
	return (def.arity != null) ? {min: def.arity, max: def.arity} : {min: def.minArity, max: def.maxArity};
};

/** Whether a node, or anything inside it, calls an asynchronous function. */
HmiExpr.hasAsync = function(node)
{
	if (node == null || typeof node !== 'object')
	{
		return false;
	}

	if (node.type === 'call' && !node.sync &&
		HmiExpr.FUNCTIONS[node.name] != null && HmiExpr.FUNCTIONS[node.name].async)
	{
		return true;
	}

	for (var key in node)
	{
		var v = node[key];

		if (v != null && typeof v === 'object' && (Array.isArray(v) ? v.some(HmiExpr.hasAsync) : HmiExpr.hasAsync(v)))
		{
			return true;
		}
	}

	return false;
};

/** The asynchronous call a statement is made of, or null. */
HmiExpr.asyncCallOf = function(statement)
{
	var call = (statement.type === 'expr' || statement.type === 'assign') ? statement.value : null;

	return (call != null && call.type === 'call' && !call.sync &&
		HmiExpr.FUNCTIONS[call.name] != null &&
		HmiExpr.FUNCTIONS[call.name].async) ? call : null;
};

HmiExpr.num = function(v)
{
	if (typeof v === 'boolean')
	{
		return (v) ? 1 : 0;
	}

	var n = parseFloat(v);

	if (isNaN(n))
	{
		throw new HmiExpr.RuntimeError('not a number: ' + JSON.stringify(v));
	}

	return n;
};

/** InTouch-style picture format: digits after the point decide precision. */
HmiExpr.picture = function(n, format)
{
	var dot = format.indexOf('.');
	var decimals = (dot >= 0) ? format.length - dot - 1 : 0;
	var text = n.toFixed(decimals);
	var intDigits = (dot >= 0) ? dot : format.length;
	var parts = text.split('.');
	var sign = '';

	if (parts[0].charAt(0) === '-')
	{
		sign = '-';
		parts[0] = parts[0].substring(1);
	}

	while (parts[0].length < intDigits)
	{
		parts[0] = '0' + parts[0];
	}

	return sign + parts.join('.');
};

// ----------------------------------------------------------------- errors

HmiExpr.RuntimeError = function(message)
{
	this.message = message;
	this.name = 'HmiExprRuntimeError';
};

/**
 * Thrown by Return and caught where the QuickFunction was called.
 *
 * Unwinding this way costs nothing in the statement executors: a flag would
 * have to be honoured in resume's loop, in its inline IF handling and in
 * eval_if, and a branch that forgot it would keep running statements after a
 * Return with nothing to show that it had.
 */
HmiExpr.ReturnSignal = function(result)
{
	this.result = result;
	this.name = 'HmiExprReturn';
};

/** What a QuickFunction gives back when no Return ran. */
HmiExpr.quickDefault = function()
{
	return {value: 0, quality: HmiTypes.QUALITY_GOOD, timestamp: Date.now()};
};

// ------------------------------------------------------------------ lexer

HmiExpr.Lexer = function(src)
{
	this.src = ('' + src);
	this.pos = 0;
	this.tokens = [];
	this.errors = [];
};

HmiExpr.Lexer.prototype.isIdentStart = function(ch)
{
	return /[A-Za-z_$]/.test(ch);
};

HmiExpr.Lexer.prototype.isIdentPart = function(ch)
{
	return /[A-Za-z0-9_$]/.test(ch);
};

HmiExpr.Lexer.prototype.push = function(type, value, start)
{
	this.tokens.push({type: type, value: value, start: start,
		length: this.pos - start});
};

HmiExpr.Lexer.prototype.error = function(message, start, length)
{
	this.errors.push({message: message, start: start,
		length: (length != null) ? length : 1});
};

HmiExpr.Lexer.prototype.run = function()
{
	var s = this.src;

	while (this.pos < s.length)
	{
		var start = this.pos;
		var ch = s.charAt(this.pos);

		if (/\s/.test(ch))
		{
			this.pos++;
			continue;
		}

		// Brace comments. Non-nesting, which is what InTouch does: the first
		// closing brace ends the comment however many were opened.
		if (ch === '{')
		{
			var close = s.indexOf('}', this.pos + 1);

			if (close < 0)
			{
				this.error('unterminated comment', start, s.length - start);
				this.pos = s.length;
			}
			else
			{
				this.pos = close + 1;
			}

			continue;
		}

		if (ch === '}')
		{
			this.error('unexpected }', start);
			this.pos++;
			continue;
		}

		if (ch === '"')
		{
			this.readString(start);
			continue;
		}

		if (/[0-9]/.test(ch) ||
			(ch === '.' && /[0-9]/.test(s.charAt(this.pos + 1))))
		{
			this.readNumber(start);
			continue;
		}

		if (this.isIdentStart(ch))
		{
			this.readIdent(start);
			continue;
		}

		this.readOperator(start);
	}

	this.tokens.push({type: HmiExpr.T.END, value: null, start: this.pos,
		length: 0});

	return this;
};

HmiExpr.Lexer.prototype.readString = function(start)
{
	var s = this.src;
	this.pos++;

	var text = '';

	while (this.pos < s.length)
	{
		var ch = s.charAt(this.pos);

		if (ch === '"')
		{
			this.pos++;
			this.push(HmiExpr.T.STRING, text, start);

			return;
		}

		if (ch === '\n' || ch === '\r')
		{
			break;
		}

		text += ch;
		this.pos++;
	}

	this.error('unterminated string', start, this.pos - start);
	this.push(HmiExpr.T.STRING, text, start);
};

HmiExpr.Lexer.prototype.readNumber = function(start)
{
	var s = this.src;
	var seenDot = false;

	while (this.pos < s.length)
	{
		var ch = s.charAt(this.pos);

		if (/[0-9]/.test(ch))
		{
			this.pos++;
		}
		else if (ch === '.' && !seenDot && /[0-9]/.test(s.charAt(this.pos + 1)))
		{
			seenDot = true;
			this.pos++;
		}
		else
		{
			break;
		}
	}

	this.push(HmiExpr.T.NUMBER, parseFloat(s.substring(start, this.pos)), start);
};

/**
 * Identifiers are lexed greedily and only then reclassified as word operators
 * on a whole-token match. Lexing the keyword first would split a tag named
 * Android into AND + roid.
 */
HmiExpr.Lexer.prototype.readIdent = function(start)
{
	var s = this.src;

	while (this.pos < s.length && this.isIdentPart(s.charAt(this.pos)))
	{
		this.pos++;
	}

	var text = s.substring(start, this.pos);
	var upper = text.toUpperCase();

	if (HmiExpr.WORD_OPS[upper] != null)
	{
		this.push(HmiExpr.T.OP, upper, start);

		return;
	}

	if (text.length > HmiExpr.MAX_NAME)
	{
		this.error('name longer than ' + HmiExpr.MAX_NAME + ' characters',
			start, text.length);
	}

	this.push(HmiExpr.T.IDENT, text, start);
};

HmiExpr.Lexer.prototype.readOperator = function(start)
{
	var s = this.src;
	var two = s.substr(this.pos, 2);

	if (two === '==' || two === '<>' || two === '<=' || two === '>=' ||
		two === '**')
	{
		this.pos += 2;
		this.push(HmiExpr.T.OP, two, start);

		return;
	}

	var one = s.charAt(this.pos);

	// ':' carries the qualified InTouch:Tag form, which parseReference folds
	// back to the bare name.
	if ('+-*/=<>().;,:'.indexOf(one) >= 0)
	{
		this.pos++;
		this.push(HmiExpr.T.OP, one, start);

		return;
	}

	this.error('unexpected character ' + JSON.stringify(one), start);
	this.pos++;
};

// ------------------------------------------------------- the loop keywords

/**
 * Whether a token begins an expression, which is what has to follow WHILE.
 * Unlike startsValue, which answers the same question for Return, the end of
 * the source and a `;` are not expressions: a WHILE always has a condition.
 */
HmiExpr.startsExpr = function(t)
{
	if (t == null)
	{
		return false;
	}

	if (t.type === HmiExpr.T.NUMBER || t.type === HmiExpr.T.STRING ||
		t.type === HmiExpr.T.IDENT)
	{
		return true;
	}

	return t.type === HmiExpr.T.OP && (t.value === '(' || t.value === '-' ||
		t.value === '+' || t.value === 'NOT');
};

/** Whether a value has to come after this token, which a keyword never is. */
HmiExpr.wantsValue = function(t, words, i)
{
	if (t == null)
	{
		return false;
	}

	if (t.type === HmiExpr.T.OP)
	{
		return HmiExpr.VALUE_WANTED[t.value] === 1;
	}

	// TO, STEP and WHILE are followed by a value too, and they are words of
	// this same contextual kind, so the classification so far decides
	var word = (words != null) ? words[i] : null;

	return word === 'TO' || word === 'STEP' || word === 'WHILE';
};

/** Whether a NEXT or an ENDWHILE could be the one this token follows. */
HmiExpr.endsStatement = function(t)
{
	if (t == null || t.type === HmiExpr.T.END || t.type === HmiExpr.T.IDENT)
	{
		return true;
	}

	return t.type === HmiExpr.T.OP && (t.value === ';' || t.value === 'ELSE' ||
		t.value === 'ENDIF');
};

/**
 * TO and then STEP, in the header of the FOR whose `=` is at `start`.
 *
 * The header has no terminator of its own -- the body simply begins where the
 * last bound ends -- so the scan stops at the `;`, at a block word, or at an
 * assignment, which a header never holds after its own. That last test is what
 * keeps `FOR i = 1 TO 10 Step = i;` reading as a loop over a tag named Step.
 */
HmiExpr.markForHeader = function(tokens, start, words)
{
	var to = -1;

	for (var j = start; j < tokens.length; j++)
	{
		var t = tokens[j];
		var next = tokens[j + 1];

		if (t.type === HmiExpr.T.END ||
			(t.type === HmiExpr.T.OP && (t.value === ';' || t.value === 'THEN' ||
				t.value === 'ELSE' || t.value === 'ENDIF')))
		{
			return;
		}

		if (t.type !== HmiExpr.T.IDENT)
		{
			continue;
		}

		// The body's first statement
		if (next != null && next.type === HmiExpr.T.OP && next.value === '=')
		{
			return;
		}

		var upper = t.value.toUpperCase();
		// A bound is an expression, so the word right after TO or an operator
		// is a tag of that name: FOR i = 1 TO Step STEP 2 loops to the tag
		// Step, by two
		var value = HmiExpr.wantsValue(tokens[j - 1], words, j - 1);

		if (to < 0 && upper === 'TO' && !value)
		{
			words[j] = 'TO';
			to = j;
		}
		else if (to >= 0 && upper === 'STEP' && !value)
		{
			words[j] = 'STEP';

			return;
		}
		else if (upper === 'FOR' || upper === 'WHILE' || upper === 'NEXT' ||
			upper === 'ENDWHILE')
		{
			return;
		}
	}
};

/**
 * Which tokens are loop keywords rather than tags of the same name:
 * {index: 'FOR' | 'TO' | 'STEP' | 'NEXT' | 'WHILE' | 'ENDWHILE'}.
 *
 * Each word is told apart by what stands next to it. FOR needs a name and an
 * assignment after it, which no reading of a tag called For can have; WHILE
 * needs a value after it; NEXT and ENDWHILE end a statement and are never
 * where a value is wanted. TO and STEP are marked only inside a header a FOR
 * has already been found for.
 */
HmiExpr.loopWords = function(tokens)
{
	var words = {};

	for (var i = 0; i < tokens.length; i++)
	{
		var t = tokens[i];

		if (t.type !== HmiExpr.T.IDENT)
		{
			continue;
		}

		var upper = t.value.toUpperCase();

		if (HmiExpr.LOOP_WORDS[upper] == null || upper === 'TO' ||
			upper === 'STEP')
		{
			continue;
		}

		var prev = (i > 0) ? tokens[i - 1] : null;
		var next = tokens[i + 1];
		var after = tokens[i + 2];

		if (upper === 'FOR')
		{
			if (next != null && next.type === HmiExpr.T.IDENT &&
				after != null && after.type === HmiExpr.T.OP && after.value === '=')
			{
				words[i] = 'FOR';
				HmiExpr.markForHeader(tokens, i + 3, words);
			}
		}
		else if (upper === 'WHILE')
		{
			if (!HmiExpr.wantsValue(prev, words, i - 1) && HmiExpr.startsExpr(next))
			{
				words[i] = 'WHILE';
			}
		}
		else if (!HmiExpr.wantsValue(prev, words, i - 1) &&
			HmiExpr.endsStatement(next))
		{
			words[i] = upper;
		}
	}

	return words;
};

/** Whether a statement is a block, which needs no `;` to close it. */
HmiExpr.isBlock = function(statement)
{
	return statement != null && (statement.type === 'if' ||
		statement.type === 'for' || statement.type === 'while');
};

// ----------------------------------------------------------------- parser

HmiExpr.Parser = function(tokens, opts)
{
	this.tokens = tokens;
	this.i = 0;
	this.opts = opts || {};
	this.project = this.opts.project;
	this.errors = [];
	this.deps = [];
	this.writes = [];
	// Local variables declared so far (DIM), by lower-case name
	this.locals = {};
	// How many blocks the parser is inside: DIM is allowed only outside them
	this.depth = 0;
	// The loop keywords, by token index. An animation link holds one
	// expression and no loops, so there a tag named While or Next is only
	// ever a tag.
	this.loopWords = (HmiExpr.isStatements(this.opts.mode)) ?
		HmiExpr.loopWords(tokens) : {};
	// The terminators of the loops this statement is inside, so an unclosed
	// IF reports itself at the NEXT rather than swallowing it
	this.blockStops = [];
	// Whether this source writes a tag or calls a function that acts: a
	// QuickFunction built from those can only be called from a script
	this.callsAction = false;
	this.callsImpure = false;

	// A QuickFunction's arguments behave exactly like local variables, so
	// they are declared before the body is parsed: resolution, assignment,
	// coercion and staying out of the dependencies all work unchanged.
	var fn = this.opts.fn;

	for (var i = 0; fn != null && fn.args != null && i < fn.args.length; i++)
	{
		if (fn.args[i].name)
		{
			this.locals[('' + fn.args[i].name).toLowerCase()] =
				{name: fn.args[i].name,
					vtype: HmiQuickFn.normalizeType(fn.args[i].type)};
		}
	}
};

/**
 * peek and next clamp at the END token. Error recovery advances the cursor to
 * avoid spinning, which without this would step past the end and leave every
 * later peek undefined -- turning a syntax error into a crash.
 */
HmiExpr.Parser.prototype.peek = function()
{
	var t = this.tokens[this.i];

	return (t != null) ? t : this.tokens[this.tokens.length - 1];
};

HmiExpr.Parser.prototype.next = function()
{
	var t = this.peek();

	if (this.i < this.tokens.length - 1)
	{
		this.i++;
	}

	return t;
};

HmiExpr.Parser.prototype.atOp = function(op)
{
	var t = this.peek();

	return t.type === HmiExpr.T.OP && t.value === op;
};

HmiExpr.Parser.prototype.eatOp = function(op)
{
	if (this.atOp(op))
	{
		this.i++;

		return true;
	}

	return false;
};

/** Whether the token here is being used as this loop keyword. */
HmiExpr.Parser.prototype.atLoopWord = function(word)
{
	return this.loopWords[this.i] === word;
};

HmiExpr.Parser.prototype.eatLoopWord = function(word)
{
	if (this.atLoopWord(word))
	{
		this.i++;

		return true;
	}

	return false;
};

HmiExpr.Parser.prototype.error = function(message, token)
{
	token = token || this.peek();
	this.errors.push({message: message, start: token.start,
		length: Math.max(1, token.length)});
};

/** An expression: one value, no statements. */
HmiExpr.Parser.prototype.parseExpression = function()
{
	var node = this.parseOr();

	if (this.peek().type !== HmiExpr.T.END)
	{
		this.error('unexpected ' + this.describe(this.peek()));
	}

	return node;
};

/** A script: a sequence of `;`-terminated statements. */
HmiExpr.Parser.prototype.parseScript = function()
{
	var statements = [];

	while (this.peek().type !== HmiExpr.T.END)
	{
		var before = this.i;
		var statement = this.parseStatement();
		statements.push(statement);

		// "ENDIF;" is the usual spelling, but a bare ENDIF is unambiguous so
		// it is not worth rejecting. The same goes for NEXT and ENDWHILE.
		if (!this.eatOp(';') && this.peek().type !== HmiExpr.T.END &&
			!HmiExpr.isBlock(statement))
		{
			this.error('expected ;');
		}

		// Never spin on a token the statement parser could not consume.
		if (this.i === before)
		{
			this.i++;
		}
	}

	return {type: 'script', body: statements};
};

HmiExpr.Parser.prototype.parseStatement = function()
{
	if (this.atReturn())
	{
		return this.parseReturn();
	}

	if (this.atOp('IF'))
	{
		return this.parseIf();
	}

	if (this.atLoopWord('FOR'))
	{
		return this.parseFor();
	}

	if (this.atLoopWord('WHILE'))
	{
		return this.parseWhile();
	}

	if (this.atLoopWord('NEXT') || this.atLoopWord('ENDWHILE'))
	{
		var stray = this.next();

		this.error(stray.value.toUpperCase() + ' without ' +
			((stray.value.toUpperCase() === 'NEXT') ? 'FOR' : 'WHILE'), stray);

		return {type: 'expr', value: {type: 'literal', value: 0}};
	}

	if (this.atDim())
	{
		return this.parseDim();
	}

	var start = this.i;
	var node = this.parseOr();

	if (this.atOp('='))
	{
		this.next();
		this.checkAssignTarget(node, this.tokens[start]);

		var valueStart = this.i;
		var assign = {type: 'assign', target: node, value: this.parseOr()};
		this.checkAsync(assign, this.tokens[valueStart]);

		return assign;
	}

	var statement = {type: 'expr', value: node};
	this.checkAsync(statement, this.tokens[start]);

	return statement;
};

/**
 * What a value can be stored in: a local variable, or a tag, which counts as
 * a write. Shared by an assignment and by a FOR, whose loop variable is
 * assigned every pass.
 */
HmiExpr.Parser.prototype.checkAssignTarget = function(node, token)
{
	var system = (node.type === 'ref') ? HmiTypes.SYSTEM_TAGS[node.name] : null;

	if (node.type === 'local')
	{
		// A local variable is assigned in the script, not written to a tag
	}
	else if (node.type !== 'ref')
	{
		this.error('only a tag or a local variable can be assigned to', token);
	}
	// Writing 1 to .Acked acknowledges the tag's alarm; no other field
	// can be written
	else if (node.field != null && node.field !== 'Value' && node.field !== 'Acked')
	{
		this.error('cannot assign to .' + node.field, token);
	}
	else if (system != null && system.readOnly)
	{
		this.error(node.name + ' is read-only', token);
	}
	else if (mxUtils.indexOf(this.writes, node.name) < 0)
	{
		this.writes.push(node.name);
	}
};

/** DIM, then a name: a declaration (a tag named Dim is assigned or read with = or an operator). */
HmiExpr.Parser.prototype.atDim = function()
{
	var t = this.peek();
	var n = this.tokens[this.i + 1];

	return HmiExpr.isStatements(this.opts.mode) && t.type === HmiExpr.T.IDENT &&
		t.value.toUpperCase() === 'DIM' && n != null && n.type === HmiExpr.T.IDENT;
};

/**
 * Whether a token can begin a value, which is how Return is told from a tag
 * of that name: Return = 1, Return.Value and Return(x) are the tag, and
 * anything else at the start of a statement is the keyword.
 */
HmiExpr.startsValue = function(t)
{
	if (t == null)
	{
		return false;
	}

	if (t.type === HmiExpr.T.NUMBER || t.type === HmiExpr.T.STRING ||
		t.type === HmiExpr.T.END)
	{
		return true;
	}

	if (t.type === HmiExpr.T.IDENT)
	{
		return true;
	}

	return t.type === HmiExpr.T.OP && (t.value === '(' || t.value === '-' ||
		t.value === '+' || t.value === 'NOT' || t.value === ';');
};

/**
 * Return is a word only where a statement begins and a value follows, the way
 * DIM is. A project with a tag named Return keeps working everywhere else.
 */
HmiExpr.Parser.prototype.atReturn = function()
{
	var t = this.peek();

	return t.type === HmiExpr.T.IDENT && t.value.toUpperCase() === 'RETURN' &&
		HmiExpr.startsValue(this.tokens[this.i + 1]);
};

/**
 * Return [value]
 *
 * Gives a value back from a QuickFunction and stops it there. Without a value
 * it gives the same 0 a function that never returns does.
 */
HmiExpr.Parser.prototype.parseReturn = function()
{
	var word = this.next();

	if (this.opts.mode !== 'quick')
	{
		this.error('Return can only be used in a QuickFunction', word);
	}

	if (this.atOp(';') || this.peek().type === HmiExpr.T.END)
	{
		return {type: 'return', value: null};
	}

	return {type: 'return', value: this.parseOr()};
};

/**
 * DIM name[, name ...] AS Analog | Discrete | Message
 *
 * A name is a local variable from here to the end of the script. Strict: it
 * may not be a tag's name (whatever its case), a system tag's, or one already
 * declared, so a name in a script always means one thing.
 */
HmiExpr.Parser.prototype.parseDim = function()
{
	var dim = this.next();
	var names = [];

	if (this.depth > 0)
	{
		this.error('DIM cannot be inside IF, FOR or WHILE: declare variables at the top level of the script', dim);
	}

	do
	{
		var t = this.peek();

		if (t.type !== HmiExpr.T.IDENT || t.value.toUpperCase() === 'AS')
		{
			this.error('expected a variable name, found ' + this.describe(t));

			break;
		}

		this.next();
		names.push(t);
	}
	while (this.eatOp(','));

	var as = this.peek();
	var type = null;

	if (as.type === HmiExpr.T.IDENT && as.value.toUpperCase() === 'AS')
	{
		this.next();
		var tt = this.peek();
		type = (tt.type === HmiExpr.T.IDENT) ? HmiExpr.LOCAL_TYPES[tt.value.toLowerCase()] : null;

		if (type == null)
		{
			this.error('expected Analog, Discrete or Message after AS, found ' + this.describe(tt));
		}
		else
		{
			this.next();
		}
	}
	else if (names.length > 0)
	{
		this.error('expected AS after the variable names');
	}

	var declared = [];

	for (var i = 0; i < names.length; i++)
	{
		var name = names[i].value;
		var key = name.toLowerCase();
		var problem = null;

		if (key === 'dim' || key === 'as')
		{
			problem = name + ' is a keyword';
		}
		else if (name.charAt(0) === '$')
		{
			problem = 'variable names cannot start with $';
		}
		else if (HmiExpr.LOCAL_TYPES[key] != null)
		{
			problem = name + ' is a type name';
		}
		else if (this.locals[key] != null)
		{
			problem = 'variable "' + name + '" is already declared';
		}
		else if (HmiTypes.systemTag(name) != null)
		{
			problem = 'variable "' + name + '" has the name of a system tag';
		}
		else if (this.project != null && this.project.getTag(name) != null)
		{
			problem = 'variable "' + name + '" has the name of the tag "' + this.project.getTag(name).name + '"';
		}

		if (problem != null)
		{
			this.error(problem, names[i]);
		}
		else if (type != null)
		{
			this.locals[key] = {name: name, vtype: type};
			declared.push({name: name, key: key});
		}
	}

	return {type: 'dim', vtype: type, names: declared};
};

/**
 * An asynchronous function (ShowRecipeSelect) pauses the script, so it can
 * only be a statement of its own or the whole value of an assignment.
 */
HmiExpr.Parser.prototype.checkAsync = function(statement, token)
{
	if (this.opts.mode === 'quick')
	{
		return;
	}

	var call = HmiExpr.asyncCallOf(statement);
	var rest = (call != null) ? call.args : statement.value;

	if (HmiExpr.hasAsync(rest))
	{
		this.asyncError(rest, token);
	}
};

HmiExpr.Parser.prototype.asyncError = function(node, token)
{
	var name = 'ShowRecipeSelect';

	(function find(n)
	{
		if (n != null && typeof n === 'object')
		{
			if (n.type === 'call' && HmiExpr.FUNCTIONS[n.name] != null && HmiExpr.FUNCTIONS[n.name].async)
			{
				name = n.name;
			}

			for (var k in n)
			{
				find(n[k]);
			}
		}
	})(node);

	// A database call says why it cannot sit in the middle of an expression:
	// it waits for an answer, and the form it waits in is the one every one of
	// them is written in anyway
	var waits = (typeof HmiSql !== 'undefined' && HmiSql.isAsyncFunction != null &&
		HmiSql.isAsyncFunction(name)) ?
		'() waits for the database, so it must be a statement or the value of an ' +
		'assignment (ResultCode = ' + name + '(...))' :
		'() must be a statement or the value of an assignment';

	this.error(name + waits, token);
};

/**
 * IF <condition> THEN <statements> [ELSE <statements>] ENDIF
 *
 * There is no ELSEIF: an else branch is a statement list, so a nested IF
 * inside it reads the same and needs no extra grammar. Each nested IF closes
 * with its own ENDIF, which keeps the parse unambiguous.
 */
HmiExpr.Parser.prototype.parseIf = function()
{
	this.next();
	this.depth++;

	var condStart = this.i;
	var condition = this.parseOr();

	if (HmiExpr.hasAsync(condition))
	{
		this.asyncError(condition, this.tokens[condStart]);
	}

	if (!this.eatOp('THEN'))
	{
		this.error('expected THEN');
	}

	var then = this.parseStatementsUntil(['ELSE', 'ENDIF']);
	var otherwise = [];

	if (this.eatOp('ELSE'))
	{
		otherwise = this.parseStatementsUntil(['ENDIF']);
	}

	if (!this.eatOp('ENDIF'))
	{
		this.error('expected ENDIF');
	}

	this.depth--;

	return {type: 'if', condition: condition, then: then, otherwise: otherwise};
};

/**
 * FOR <tag or variable> = <start> TO <end> [STEP <by>]
 *     statements
 * NEXT
 *
 * The bounds are read once, as the loop is entered, and the count is kept by
 * the evaluator rather than read back from the loop variable: a tag's value
 * comes back from the driver, which may not have it yet, and a loop that
 * waited for that would never finish. Prefer a DIM variable for a counter --
 * a tag is written on every pass.
 */
HmiExpr.Parser.prototype.parseFor = function()
{
	this.next();
	this.depth++;
	this.blockStops.push('NEXT');

	var start = this.i;
	var target = this.parseOr();
	this.checkAssignTarget(target, this.tokens[start]);

	if (!this.eatOp('='))
	{
		this.error('expected = after the FOR variable');
	}

	var from = this.parseLoopValue();

	if (!this.eatLoopWord('TO'))
	{
		this.error('expected TO');
	}

	var to = this.parseLoopValue();
	var step = (this.eatLoopWord('STEP')) ? this.parseLoopValue() : null;
	var body = this.parseStatementsUntil(['NEXT']);

	if (!this.eatLoopWord('NEXT'))
	{
		this.error('expected NEXT');
	}

	this.blockStops.pop();
	this.depth--;

	return {type: 'for', target: target, from: from, to: to, step: step,
		body: body};
};

/**
 * WHILE <condition>
 *     statements
 * ENDWHILE
 *
 * The condition is evaluated again before every pass. Bad quality ends the
 * loop, for the reason eval_if gives: nothing acts on a value nothing trusts.
 */
HmiExpr.Parser.prototype.parseWhile = function()
{
	this.next();
	this.depth++;
	this.blockStops.push('ENDWHILE');

	var condition = this.parseLoopValue();
	var body = this.parseStatementsUntil(['ENDWHILE']);

	if (!this.eatLoopWord('ENDWHILE'))
	{
		this.error('expected ENDWHILE');
	}

	this.blockStops.pop();
	this.depth--;

	return {type: 'while', condition: condition, body: body};
};

/** A loop's condition or bound: an expression that cannot pause. */
HmiExpr.Parser.prototype.parseLoopValue = function()
{
	var start = this.i;
	var node = this.parseOr();

	if (HmiExpr.hasAsync(node))
	{
		this.asyncError(node, this.tokens[start]);
	}

	return node;
};

/**
 * Whether the token here closes a block: one of this list, or a terminator of
 * a loop the statement is inside, which is what makes a missing ENDIF report
 * itself at the NEXT instead of running on to the end of the script.
 */
HmiExpr.Parser.prototype.atAnyStop = function(stops)
{
	for (var i = 0; i < stops.length; i++)
	{
		if (this.atOp(stops[i]) || this.atLoopWord(stops[i]))
		{
			return true;
		}
	}

	for (var j = 0; j < this.blockStops.length; j++)
	{
		if (this.atLoopWord(this.blockStops[j]))
		{
			return true;
		}
	}

	return false;
};

HmiExpr.Parser.prototype.parseStatementsUntil = function(stops)
{
	var body = [];

	while (this.peek().type !== HmiExpr.T.END && !this.atAnyStop(stops))
	{
		var before = this.i;
		var statement = this.parseStatement();
		body.push(statement);

		// A block's statements end in ';', but the last one before ELSE,
		// ENDIF, NEXT or ENDWHILE may omit it, and a nested block needs none
		// after its own end.
		if (!this.eatOp(';') && !this.atAnyStop(stops) &&
			this.peek().type !== HmiExpr.T.END && !HmiExpr.isBlock(statement))
		{
			this.error('expected ;');
		}

		if (this.i === before)
		{
			this.i++;
		}
	}

	return body;
};

HmiExpr.Parser.prototype.parseOr = function()
{
	var node = this.parseAnd();

	while (this.atOp('OR'))
	{
		this.next();
		node = {type: 'logical', op: 'OR', left: node, right: this.parseAnd()};
	}

	return node;
};

HmiExpr.Parser.prototype.parseAnd = function()
{
	var node = this.parseNot();

	while (this.atOp('AND'))
	{
		this.next();
		node = {type: 'logical', op: 'AND', left: node, right: this.parseNot()};
	}

	return node;
};

HmiExpr.Parser.prototype.parseNot = function()
{
	if (this.atOp('NOT'))
	{
		this.next();

		return {type: 'not', value: this.parseNot()};
	}

	return this.parseComparison();
};

HmiExpr.COMPARISONS = {'==': true, '<>': true, '<': true, '<=': true,
	'>': true, '>=': true};

HmiExpr.Parser.prototype.parseComparison = function()
{
	var node = this.parseAdditive();
	var t = this.peek();

	while (t.type === HmiExpr.T.OP && HmiExpr.COMPARISONS[t.value])
	{
		this.next();
		node = {type: 'compare', op: t.value, left: node,
			right: this.parseAdditive()};
		t = this.peek();
	}

	// A single = where a comparison was meant is the classic slip, and it
	// would otherwise parse as a statement and silently write to a tag.
	if (this.atOp('=') && !HmiExpr.isStatements(this.opts.mode))
	{
		this.error('use == to compare, = assigns');
	}

	return node;
};

HmiExpr.Parser.prototype.parseAdditive = function()
{
	var node = this.parseMultiplicative();

	while (this.atOp('+') || this.atOp('-'))
	{
		var op = this.next().value;
		node = {type: 'binary', op: op, left: node,
			right: this.parseMultiplicative()};
	}

	return node;
};

HmiExpr.Parser.prototype.parseMultiplicative = function()
{
	var node = this.parseUnary();

	while (this.atOp('*') || this.atOp('/') || this.atOp('MOD'))
	{
		var op = this.next().value;
		node = {type: 'binary', op: op, left: node, right: this.parseUnary()};
	}

	return node;
};

HmiExpr.Parser.prototype.parseUnary = function()
{
	if (this.atOp('-'))
	{
		this.next();

		return {type: 'negate', value: this.parseUnary()};
	}

	if (this.atOp('+'))
	{
		this.next();

		return this.parseUnary();
	}

	return this.parsePower();
};

/** Right associative, so 2 ** 3 ** 2 is 2 ** (3 ** 2). */
HmiExpr.Parser.prototype.parsePower = function()
{
	var node = this.parsePrimary();

	if (this.atOp('**'))
	{
		this.next();

		return {type: 'binary', op: '**', left: node, right: this.parseUnary()};
	}

	return node;
};

HmiExpr.Parser.prototype.parsePrimary = function()
{
	var t = this.peek();

	if (t.type === HmiExpr.T.NUMBER)
	{
		this.next();

		return {type: 'literal', value: t.value};
	}

	if (t.type === HmiExpr.T.STRING)
	{
		this.next();

		return {type: 'literal', value: t.value};
	}

	if (this.atOp('('))
	{
		this.next();
		var inner = this.parseOr();

		if (!this.eatOp(')'))
		{
			this.error('expected )');
		}

		return inner;
	}

	if (t.type === HmiExpr.T.IDENT)
	{
		return this.parseReference();
	}

	this.error('expected a value, found ' + this.describe(t));
	this.next();

	return {type: 'literal', value: null};
};

/**
 * A tag reference with an optional dotfield, or a function call.
 *
 * References are resolved against the dictionary here, at compile time, so an
 * unknown tag or an unknown dotfield is a design-time error rather than a
 * runtime surprise.
 */
HmiExpr.Parser.prototype.parseReference = function()
{
	var t = this.next();
	var name = t.value;

	// InTouch:Tag is the qualified form; it names the same tag.
	if (/^[Ii]n[Tt]ouch$/.test(name) && this.atOp(':'))
	{
		this.next();
		var q = this.next();
		name = (q.type === HmiExpr.T.IDENT) ? q.value : name;
	}

	if (this.atOp('('))
	{
		return this.parseCall(name, t);
	}

	var field = null;

	if (this.atOp('.'))
	{
		this.next();
		var f = this.peek();

		if (f.type !== HmiExpr.T.IDENT)
		{
			this.error('expected a field name after .');
		}
		else
		{
			this.next();
			field = f.value;

			if (HmiTypes.DOTFIELDS[field] == null)
			{
				this.error('unknown field .' + field, f);
			}
		}
	}

	// A declared local variable (DIM): no fields, not a tag, not subscribed
	var local = this.locals[name.toLowerCase()];

	if (local != null)
	{
		if (field != null)
		{
			this.error('the local variable "' + local.name + '" has no fields', t);
		}

		return {type: 'local', name: local.name, key: name.toLowerCase(), vtype: local.vtype};
	}

	// System tags are supplied by the runtime, not the dictionary.
	var system = HmiTypes.systemTag(name);

	if (system != null)
	{
		name = system;
	}
	else if (this.project != null && name.charAt(0) !== '$' &&
		this.project.getTag(name) == null)
	{
		this.error('unknown tag "' + name + '"', t);
	}

	if (mxUtils.indexOf(this.deps, name) < 0)
	{
		this.deps.push(name);
	}

	return {type: 'ref', name: name, field: field};
};

HmiExpr.Parser.prototype.parseCall = function(name, token)
{
	this.next();

	var args = [];

	if (!this.atOp(')'))
	{
		do
		{
			args.push(this.parseOr());
		}
		while (this.eatOp(','));
	}

	if (!this.eatOp(')'))
	{
		this.error('expected )');
	}

	var def = HmiExpr.FUNCTIONS[name];

	if (def == null)
	{
		// Case-insensitive second chance, since QuickScript is forgiving.
		for (var key in HmiExpr.FUNCTIONS)
		{
			if (key.toLowerCase() === name.toLowerCase())
			{
				def = HmiExpr.FUNCTIONS[key];
				name = key;
				break;
			}
		}
	}

	// A QuickFunction the project defines, which the built-ins outrank: a
	// function may not be stored under a built-in's name, so the two sets
	// cannot overlap by the time a call gets here.
	if (def == null && this.project != null &&
		typeof HmiQuickFn !== 'undefined')
	{
		var quick = HmiQuickFn.find(HmiQuickFn.listOf(this.project), name);

		if (quick != null)
		{
			return this.parseQuickCall(quick, args, token);
		}
	}

	if (def == null)
	{
		this.error('unknown function "' + name + '"', token);
	}
	else if (args.length < HmiExpr.arityOf(def).min || args.length > HmiExpr.arityOf(def).max)
	{
		var arity = HmiExpr.arityOf(def);
		var count = (arity.min === arity.max) ? '' + arity.min : arity.min + ' to ' + arity.max;
		this.error(name + ' takes ' + count + ' argument' +
			((arity.max === 1) ? '' : 's') + ', got ' + args.length, token);
	}
	else if (def.async && this.opts.mode === 'quick' &&
		!HmiExpr.cannotPause(name, args))
	{
		this.error(name + '() cannot be used in a QuickFunction', token);
	}
	else if (def.action && !HmiExpr.isStatements(this.opts.mode))
	{
		this.error(name + '() can only be used in a script', token);
	}
	else if (name === 'LinkIndirectTag' && this.project != null)
	{
		this.checkLink(args, token);
	}
	else if (name === 'ShowWindow' && this.project != null)
	{
		this.checkShowWindow(args, token);
	}
	else if (name.indexOf('Trend') === 0 && this.project != null)
	{
		this.checkTrendCall(name, args, token);
	}
	else if (HmiList.isFunction(name) && this.project != null)
	{
		this.checkListCall(name, args, token);
	}

	if (def != null && def.action)
	{
		// What makes a QuickFunction script-only, as it does a built-in
		this.callsAction = true;
	}

	// An argument the function writes to rather than reads: it must be a bare
	// tag, and what reaches the function is its name. It stays an ordinary tag
	// token in the source, so a rename and Find/Replace reach it as they reach
	// any other.
	for (var ta = 0; def != null && def.tagArgs != null && ta < def.tagArgs.length; ta++)
	{
		var at = def.tagArgs[ta];
		var arg = args[at];

		if (arg == null)
		{
			continue;
		}

		if (arg.type === 'local')
		{
			this.error(name + ' argument ' + (at + 1) +
				' must be a tag, not a local variable', token);
		}
		else if (arg.type !== 'ref' || arg.field != null)
		{
			this.error(name + ' argument ' + (at + 1) +
				' must be a tag for the result to be written to', token);
		}
		else if (HmiTypes.systemTag(arg.name) != null)
		{
			this.error(arg.name + ' cannot be written to', token);
		}
		else
		{
			args[at] = {type: 'tagname', name: arg.name};

			if (mxUtils.indexOf(this.writes, arg.name) < 0)
			{
				this.writes.push(arg.name);
			}
		}
	}

	var node = {type: 'call', name: name, args: args};

	if (def != null && def.async && this.opts.mode === 'quick' &&
		HmiExpr.cannotPause(name, args))
	{
		// In a QuickFunction it runs like any other action: there is nothing
		// to wait for, so nothing has to suspend. A script keeps the path it
		// has always taken.
		node.sync = true;
	}

	return node;
};

/**
 * Whether this call of an asynchronous function cannot pause.
 *
 * ShowWindow is asynchronous whenever it is asked to wait, which is its fifth
 * argument; without one it opens the window and carries straight on. Nothing
 * else that pauses has a form that does not.
 */
HmiExpr.cannotPause = function(name, args)
{
	if (name !== 'ShowWindow')
	{
		return false;
	}

	if (args.length < 5)
	{
		return true;
	}

	var wait = args[4];

	return wait != null && wait.type === 'literal' &&
		!HmiExpr.truthy(wait.value);
};

/**
 * A call of a QuickFunction: {type: 'quickcall'}, which keeps it out of
 * everything that looks for a built-in by name (hasAsync, asyncCallOf, the
 * window and trend literal checks).
 *
 * The node carries the name and nothing else. Hanging the compiled body on it
 * would send hasAsync's deep walk through the whole function set, and through
 * it again at every call.
 */
HmiExpr.Parser.prototype.parseQuickCall = function(fn, args, token)
{
	var node = {type: 'quickcall', name: fn.name, args: args};

	if (HmiQuickFn.inCycle(this.project, fn.name))
	{
		this.error('QuickFunction "' + fn.name + '" calls itself, directly ' +
			'or through another function', token);

		return node;
	}

	var wanted = (fn.args != null) ? fn.args.length : 0;

	if (args.length !== wanted)
	{
		this.error(fn.name + ' takes ' + wanted + ' argument' +
			((wanted === 1) ? '' : 's') + ', got ' + args.length, token);

		return node;
	}

	var compiled = HmiQuickFn.compile(this.project, fn);

	if (compiled.impure && !HmiExpr.isStatements(this.opts.mode))
	{
		this.error(fn.name + '() writes a tag or calls an action function, ' +
			'so it can only be used in a script', token);

		return node;
	}

	if (compiled.errors.length > 0)
	{
		this.error('QuickFunction "' + fn.name + '" has an error: ' +
			compiled.errors[0].message, token);

		return node;
	}

	// What the body reads and writes, the caller reads and writes: this is
	// what subscribes a tag an animation link only reaches through a
	// function, and it is transitive because the callee was compiled first.
	for (var i = 0; i < compiled.deps.length; i++)
	{
		if (mxUtils.indexOf(this.deps, compiled.deps[i]) < 0)
		{
			this.deps.push(compiled.deps[i]);
		}
	}

	for (var w = 0; w < compiled.writes.length; w++)
	{
		if (mxUtils.indexOf(this.writes, compiled.writes[w]) < 0)
		{
			this.writes.push(compiled.writes[w]);
		}
	}

	this.callsImpure = this.callsImpure || compiled.impure;

	return node;
};

/**
 * ShowWindow takes the window name as text (a literal or a message tag), and
 * a position in numbers; "" leaves the window where it is defined. Literal
 * window names are checked against the pages by Validate (HmiMenus).
 */
HmiExpr.Parser.prototype.checkShowWindow = function(args, token)
{
	var a = args[0];

	if (a.type === 'ref' && a.field == null)
	{
		var tag = this.project.getTag(a.name);

		if (tag != null && !HmiTypes.isMessage(tag.type))
		{
			this.error('ShowWindow takes the window name as text: write the name in quotes, or use a message tag', token);
		}
	}
	else if (a.type === 'literal' && (typeof a.value !== 'string' || a.value.trim() === ''))
	{
		this.error('ShowWindow: the window name is empty', token);
	}

	var what = ['left', 'top'];

	for (var i = 1; i <= 2 && i < args.length; i++)
	{
		if (args[i].type === 'literal' && typeof args[i].value === 'string' && args[i].value !== '' &&
			isNaN(parseFloat(args[i].value)))
		{
			this.error('ShowWindow: ' + what[i - 1] + ' must be a number of pixels, or "" for the window\'s own', token);
		}
	}
};

/**
 * The trend functions take the trend's name, and TrendSetPen the pen's tag
 * name, as text: a bare tag reference is a likely mistake unless it is a
 * message tag holding the name. Literal trend names and pens are checked
 * against the pages by Validate (HmiMenus).
 */
HmiExpr.Parser.prototype.checkTrendCall = function(name, args, token)
{
	var what = ['the trend name', 'the pen\'s tag name'];

	for (var i = 0; i < args.length && i < 2; i++)
	{
		var a = args[i];

		if (a.type === 'ref' && a.field == null)
		{
			var tag = this.project.getTag(a.name);

			if (tag != null && !HmiTypes.isMessage(tag.type))
			{
				this.error(name + ' takes ' + what[i] + ' as text: write "' + tag.name + '" in quotes, or use a message tag', token);

				return;
			}
		}
		else if (a.type === 'literal' && (typeof a.value !== 'string' || a.value.trim() === ''))
		{
			this.error(name + ': ' + what[i] + ' is empty', token);

			return;
		}
	}
};

/**
 * The list functions take the list's name as text: a bare tag reference is a
 * likely mistake unless it is a message tag holding the name. Literal names
 * are checked against the pages by Validate (HmiMenus), and a literal sort
 * order has to be one ListSort knows.
 */
HmiExpr.Parser.prototype.checkListCall = function(name, args, token)
{
	var a = args[0];

	if (a != null && a.type === 'ref' && a.field == null)
	{
		var tag = this.project.getTag(a.name);

		if (tag != null && !HmiTypes.isMessage(tag.type))
		{
			this.error(name + ' takes the list name as text: write "' + tag.name +
				'" in quotes, or use a message tag', token);

			return;
		}
	}
	else if (a != null && a.type === 'literal' &&
		(typeof a.value !== 'string' || a.value.trim() === ''))
	{
		this.error(name + ': the list name is empty', token);

		return;
	}

	var order = (name === 'ListSort') ? args[1] : null;

	if (order != null && order.type === 'literal' &&
		(typeof order.value !== 'string' || HmiList.ORDERS[String(order.value).trim().toLowerCase()] == null))
	{
		this.error('ListSort: the sort order must be ASC, DESC, A or D', token);
	}
};

/**
 * LinkIndirectTag takes tag names as text. Names given as literals are
 * checked here, at Validate; a bare tag reference is a likely mistake unless
 * it is a message tag holding a name.
 */
HmiExpr.Parser.prototype.checkLink = function(args, token)
{
	var names = [null, null];

	for (var i = 0; i < 2; i++)
	{
		var a = args[i];

		if (a.type === 'literal' && typeof a.value === 'string')
		{
			names[i] = a.value;
		}
		else if (a.type === 'ref' && a.field == null)
		{
			var tag = this.project.getTag(a.name);

			if (tag != null && !HmiTypes.isMessage(tag.type))
			{
				this.error('LinkIndirectTag takes tag names as text: write "' + tag.name + '" in quotes', token);

				return;
			}
		}
	}

	if (names[0] != null || names[1] != null)
	{
		var problem = HmiIndirect.check(this.project, names[0], names[1]);

		if (problem != null)
		{
			this.error('LinkIndirectTag: ' + problem.replace(/\.$/, ''), token);
		}
	}
};

HmiExpr.Parser.prototype.describe = function(t)
{
	if (t.type === HmiExpr.T.END)
	{
		return 'end of expression';
	}

	return JSON.stringify('' + t.value);
};

// -------------------------------------------------------------- evaluator

HmiExpr.GOOD = function()
{
	return {quality: HmiTypes.QUALITY_GOOD, timestamp: Date.now()};
};

/** Quality is the worst of the inputs, timestamp the newest. */
HmiExpr.combine = function(parts)
{
	var quality = HmiTypes.QUALITY_GOOD;
	var timestamp = 0;

	for (var i = 0; i < parts.length; i++)
	{
		quality = Math.min(quality, parts[i].quality);
		timestamp = Math.max(timestamp, parts[i].timestamp);
	}

	return {quality: quality, timestamp: (timestamp > 0) ? timestamp : Date.now()};
};

HmiExpr.truthy = function(value)
{
	if (value == null)
	{
		return false;
	}

	if (typeof value === 'string')
	{
		return value !== '' && value !== '0';
	}

	return !!value;
};

/**
 * @param ctx the host: read, write, call, callAsync, scriptError
 * @param scope {project}, which a QuickFunction call needs to find the
 * function it names. Nothing else uses it.
 */
HmiExpr.Evaluator = function(ctx, scope)
{
	this.ctx = ctx;
	this.scope = scope || null;
};

HmiExpr.Evaluator.prototype.run = function(node)
{
	var m = this['eval_' + node.type];

	if (m == null)
	{
		throw new HmiExpr.RuntimeError('cannot evaluate ' + node.type);
	}

	return m.call(this, node);
};

HmiExpr.Evaluator.prototype.eval_literal = function(node)
{
	var meta = HmiExpr.GOOD();

	return {value: node.value, quality: meta.quality, timestamp: meta.timestamp};
};

HmiExpr.Evaluator.prototype.eval_ref = function(node)
{
	return this.ctx.read(node.name, node.field);
};

HmiExpr.Evaluator.prototype.eval_not = function(node)
{
	var v = this.run(node.value);

	return {value: !HmiExpr.truthy(v.value), quality: v.quality,
		timestamp: v.timestamp};
};

HmiExpr.Evaluator.prototype.eval_negate = function(node)
{
	var v = this.run(node.value);

	return {value: -HmiExpr.num(v.value), quality: v.quality,
		timestamp: v.timestamp};
};

/**
 * Both sides are always evaluated, deliberately. Short-circuiting would make
 * an expression's quality depend on which branch happened to run, so a screen
 * could show good quality while silently ignoring a bad tag.
 */
HmiExpr.Evaluator.prototype.eval_logical = function(node)
{
	var a = this.run(node.left);
	var b = this.run(node.right);
	var meta = HmiExpr.combine([a, b]);
	var value = (node.op === 'AND') ?
		(HmiExpr.truthy(a.value) && HmiExpr.truthy(b.value)) :
		(HmiExpr.truthy(a.value) || HmiExpr.truthy(b.value));

	return {value: value, quality: meta.quality, timestamp: meta.timestamp};
};

HmiExpr.Evaluator.prototype.eval_compare = function(node)
{
	var a = this.run(node.left);
	var b = this.run(node.right);
	var meta = HmiExpr.combine([a, b]);
	var x = a.value;
	var y = b.value;

	// Compare as numbers unless both sides are strings, so "10" > 9 behaves.
	if (!(typeof x === 'string' && typeof y === 'string'))
	{
		x = HmiExpr.num(x);
		y = HmiExpr.num(y);
	}

	var value;

	switch (node.op)
	{
		case '==': value = (x === y); break;
		case '<>': value = (x !== y); break;
		case '<': value = (x < y); break;
		case '<=': value = (x <= y); break;
		case '>': value = (x > y); break;
		case '>=': value = (x >= y); break;
		default: throw new HmiExpr.RuntimeError('bad comparison ' + node.op);
	}

	return {value: value, quality: meta.quality, timestamp: meta.timestamp};
};

HmiExpr.Evaluator.prototype.eval_binary = function(node)
{
	var a = this.run(node.left);
	var b = this.run(node.right);
	var meta = HmiExpr.combine([a, b]);
	var value;

	// + concatenates when either side is a string, as QuickScript does.
	if (node.op === '+' &&
		(typeof a.value === 'string' || typeof b.value === 'string'))
	{
		value = '' + HmiExpr.text(a.value) + HmiExpr.text(b.value);
	}
	else
	{
		var x = HmiExpr.num(a.value);
		var y = HmiExpr.num(b.value);

		switch (node.op)
		{
			case '+': value = x + y; break;
			case '-': value = x - y; break;
			case '*': value = x * y; break;
			case '**': value = Math.pow(x, y); break;
			case '/':
				if (y === 0)
				{
					throw new HmiExpr.RuntimeError('division by zero');
				}

				value = x / y;
				break;
			case 'MOD':
				if (y === 0)
				{
					throw new HmiExpr.RuntimeError('division by zero');
				}

				value = x % y;
				break;
			default:
				throw new HmiExpr.RuntimeError('bad operator ' + node.op);
		}
	}

	return {value: value, quality: meta.quality, timestamp: meta.timestamp};
};

HmiExpr.text = function(v)
{
	if (v == null)
	{
		return '';
	}

	if (typeof v === 'boolean')
	{
		return (v) ? '1' : '0';
	}

	return '' + v;
};

/**
 * An argument naming the tag a function writes its result to. It evaluates to
 * the name, so the function can write it; the tag's own value is not read.
 */
HmiExpr.Evaluator.prototype.eval_tagname = function(node)
{
	return {value: node.name, quality: HmiTypes.QUALITY_GOOD, timestamp: Date.now()};
};

HmiExpr.Evaluator.prototype.eval_call = function(node)
{
	var parts = [];
	var args = [];

	for (var i = 0; i < node.args.length; i++)
	{
		var v = this.run(node.args[i]);
		parts.push(v);
		args.push(v.value);
	}

	var def = HmiExpr.FUNCTIONS[node.name];

	if (def == null)
	{
		throw new HmiExpr.RuntimeError('unknown function ' + node.name);
	}

	var meta = HmiExpr.combine(parts);

	if (def.action)
	{
		var result = (this.ctx.call != null) ? this.ctx.call(node.name, args) : null;

		return {value: result, quality: (result != null) ? HmiTypes.QUALITY_GOOD : HmiTypes.QUALITY_BAD,
			timestamp: Date.now()};
	}

	return {value: def.fn.apply(null, args), quality: meta.quality,
		timestamp: meta.timestamp};
};

/**
 * Calls a QuickFunction: its arguments become its local variables, its body
 * runs, and Return hands a value back.
 *
 * The function is looked up by name rather than carried on the node, so the
 * project stays the one place that holds it and an edit cannot leave a stale
 * copy behind in a compiled expression.
 */
HmiExpr.Evaluator.prototype.eval_quickcall = function(node)
{
	var parts = [];

	for (var i = 0; i < node.args.length; i++)
	{
		parts.push(this.run(node.args[i]));
	}

	var project = (this.scope != null) ? this.scope.project : null;
	var compiled = (project != null && typeof HmiQuickFn !== 'undefined') ?
		HmiQuickFn.compileByName(project, node.name) : null;

	if (compiled == null || compiled.ast == null || compiled.errors.length > 0)
	{
		throw new HmiExpr.RuntimeError('QuickFunction ' + node.name +
			' is not available');
	}

	try
	{
		return this.callQuick(compiled, parts);
	}
	catch (e)
	{
		// Named, because the log keys a failure on the outermost expression:
		// without this, a fault three functions deep is a mystery.
		throw new HmiExpr.RuntimeError('in QuickFunction "' + node.name +
			'": ' + ((e != null && e.message != null) ? e.message :
				'evaluation failed'));
	}
};

/**
 * Runs a compiled body with its arguments bound, and gives back what Return
 * handed over -- or 0 when nothing did.
 *
 * The caller's statement cursors and local variables are put back afterwards,
 * because Return leaves the body by throwing.
 */
HmiExpr.Evaluator.prototype.callQuick = function(compiled, parts)
{
	this.quickDepth = (this.quickDepth || 0) + 1;
	this.quickCalls = (this.quickCalls || 0) + 1;

	var savedFrames = this.frames;
	var savedLocals = this.locals;

	try
	{
		if (this.quickDepth > HmiQuickFn.MAX_DEPTH)
		{
			throw new HmiExpr.RuntimeError('QuickFunctions nested more than ' +
				HmiQuickFn.MAX_DEPTH + ' deep');
		}

		if (this.quickCalls > HmiQuickFn.MAX_CALLS)
		{
			throw new HmiExpr.RuntimeError('more than ' + HmiQuickFn.MAX_CALLS +
				' QuickFunction calls in one evaluation');
		}

		var locals = {};

		for (var i = 0; i < compiled.args.length; i++)
		{
			var v = parts[i];
			var type = HmiQuickFn.normalizeType(compiled.args[i].type);

			// Coerced to the declared type, keeping the quality and the time
			// it was read, exactly as an assignment to a local does
			locals[('' + compiled.args[i].name).toLowerCase()] = {
				value: HmiExpr.coerceLocal(type, v.value),
				quality: v.quality, timestamp: v.timestamp};
		}

		this.runBody(compiled.ast.body, locals);

		return HmiExpr.quickDefault();
	}
	catch (e)
	{
		if (e instanceof HmiExpr.ReturnSignal)
		{
			return e.result;
		}

		throw e;
	}
	finally
	{
		this.frames = savedFrames;
		this.locals = savedLocals;
		this.quickDepth--;
	}
};

HmiExpr.Evaluator.prototype.eval_assign = function(node)
{
	var v = this.run(node.value);
	this.assign(node.target, v);

	return v;
};

/** Stores a value in a local variable, or writes it to a tag. */
HmiExpr.Evaluator.prototype.assign = function(target, v)
{
	if (target.type === 'local')
	{
		this.locals[target.key] = {value: HmiExpr.coerceLocal(target.vtype, v.value),
			quality: v.quality, timestamp: v.timestamp};
	}
	else if (this.ctx.write != null)
	{
		this.ctx.write(target.name, v.value, target.field);
	}
};

/** DIM starts each variable at 0 or "", good quality. */
HmiExpr.Evaluator.prototype.eval_dim = function(node)
{
	this.locals = this.locals || {};

	for (var i = 0; i < node.names.length; i++)
	{
		this.locals[node.names[i].key] = {value: HmiExpr.localDefault(node.vtype),
			quality: HmiTypes.QUALITY_GOOD, timestamp: Date.now()};
	}

	return {value: null, quality: HmiTypes.QUALITY_GOOD, timestamp: Date.now()};
};

HmiExpr.Evaluator.prototype.eval_local = function(node)
{
	var v = (this.locals != null) ? this.locals[node.key] : null;

	return (v != null) ? {value: v.value, quality: v.quality, timestamp: v.timestamp} :
		{value: HmiExpr.localDefault(node.vtype), quality: HmiTypes.QUALITY_GOOD, timestamp: Date.now()};
};

/**
 * A branch is taken only on trustworthy data.
 *
 * If the condition's quality is bad, NEITHER branch runs. An action script
 * writes to tags, and acting on a value known to be unreliable is how an HMI
 * ends up commanding equipment from a dead communications link. The statement
 * reports bad quality instead.
 */
HmiExpr.Evaluator.prototype.eval_if = function(node)
{
	var cond = this.run(node.condition);

	if (cond.quality <= HmiTypes.QUALITY_BAD)
	{
		return {value: null, quality: HmiTypes.QUALITY_BAD,
			timestamp: cond.timestamp};
	}

	var body = (HmiExpr.truthy(cond.value)) ? node.then : node.otherwise;
	var last = {value: null, quality: cond.quality, timestamp: cond.timestamp};

	for (var i = 0; i < body.length; i++)
	{
		last = this.run(body[i]);
	}

	return last;
};

/** Whether a FOR has reached its end, counting up or counting down. */
HmiExpr.forGoes = function(frame)
{
	return (frame.step > 0) ? frame.value <= frame.to : frame.value >= frame.to;
};

/**
 * Counts one pass of a loop against the cap for the whole run.
 *
 * Without it a condition that never comes false would hang the window it runs
 * in: a script is synchronous, so nothing else in the Run would get a turn,
 * including whatever would have made the condition false.
 */
HmiExpr.Evaluator.prototype.countPass = function()
{
	this.iterations = (this.iterations || 0) + 1;

	if (this.iterations > HmiExpr.MAX_ITERATIONS)
	{
		throw new HmiExpr.RuntimeError('more than ' + HmiExpr.MAX_ITERATIONS +
			' loop passes in one run of a script: check the loop\'s condition');
	}
};

/**
 * Enters a loop: {frame, last}. A null frame means the body never runs, which
 * is an empty range, a condition that starts false, or bad quality -- in that
 * last case the statement reports it, as an IF does.
 */
HmiExpr.Evaluator.prototype.loopEntry = function(node)
{
	var frame = {loop: node, body: node.body, i: 0};
	var last;

	if (node.type === 'for')
	{
		var from = this.run(node.from);
		var to = this.run(node.to);
		var step = (node.step != null) ? this.run(node.step) : null;
		var quality = Math.min(from.quality, to.quality,
			(step != null) ? step.quality : HmiTypes.QUALITY_GOOD);
		var when = Math.max(from.timestamp, to.timestamp,
			(step != null) ? step.timestamp : 0);

		last = {value: null, quality: quality, timestamp: when};

		if (quality <= HmiTypes.QUALITY_BAD)
		{
			return {frame: null, last: last};
		}

		frame.value = HmiExpr.num(from.value);
		frame.to = HmiExpr.num(to.value);
		frame.step = (step != null) ? HmiExpr.num(step.value) : 1;

		if (frame.step === 0)
		{
			throw new HmiExpr.RuntimeError('FOR ... STEP 0 would never finish');
		}

		// The loop variable follows the count, not the other way round
		this.assign(node.target, {value: frame.value, quality: quality,
			timestamp: Date.now()});

		if (!HmiExpr.forGoes(frame))
		{
			return {frame: null, last: last};
		}
	}
	else
	{
		var cond = this.run(node.condition);

		last = {value: null, quality: cond.quality, timestamp: cond.timestamp};

		if (cond.quality <= HmiTypes.QUALITY_BAD || !HmiExpr.truthy(cond.value))
		{
			return {frame: null, last: last};
		}
	}

	this.countPass();

	return {frame: frame, last: last};
};

/** Whether a loop whose body has just finished takes another pass. */
HmiExpr.Evaluator.prototype.loopAgain = function(frame)
{
	var node = frame.loop;

	if (node.type === 'for')
	{
		frame.value += frame.step;
		this.assign(node.target, {value: frame.value,
			quality: HmiTypes.QUALITY_GOOD, timestamp: Date.now()});

		if (!HmiExpr.forGoes(frame))
		{
			return false;
		}
	}
	else
	{
		var cond = this.run(node.condition);

		if (cond.quality <= HmiTypes.QUALITY_BAD || !HmiExpr.truthy(cond.value))
		{
			return false;
		}
	}

	this.countPass();

	return true;
};

/**
 * WHILE and FOR where a statement is run on its own rather than from the
 * frame stack, which is resume's job and the path a script actually takes.
 * The two share loopEntry and loopAgain, so the semantics are written once.
 */
HmiExpr.Evaluator.prototype.eval_while = function(node)
{
	var entry = this.loopEntry(node);
	var last = entry.last;

	while (entry.frame != null)
	{
		for (var i = 0; i < node.body.length; i++)
		{
			last = this.run(node.body[i]);
		}

		if (!this.loopAgain(entry.frame))
		{
			break;
		}
	}

	return last;
};

HmiExpr.Evaluator.prototype.eval_for = function(node)
{
	return this.eval_while(node);
};

HmiExpr.Evaluator.prototype.eval_expr = function(node)
{
	return this.run(node.value);
};

/**
 * A script runs from a stack of statement lists, so it can pause at an
 * asynchronous call (ShowRecipeSelect) and carry on from the same place when
 * the call completes: ctx.callAsync(name, args, done) shows the window and
 * done(value) assigns the value, if the call was an assignment's, and resumes.
 * IF conditions are evaluated once, as their branch is entered.
 */
HmiExpr.Evaluator.prototype.eval_script = function(node)
{
	// The loop cap is for this run of the script and everything it calls, so
	// it is reset where a run begins and not in runBody, which a
	// QuickFunction's body goes through as well
	this.iterations = 0;

	return this.runBody(node.body, {});
};

/**
 * Runs a list of statements with its own local variables: a script's, or a
 * QuickFunction body's, which starts with the arguments in it.
 */
HmiExpr.Evaluator.prototype.runBody = function(body, locals)
{
	this.frames = [{body: body, i: 0}];
	// Local variables last as long as this run, through any pause
	this.locals = locals;

	return this.resume({value: null, quality: HmiTypes.QUALITY_GOOD, timestamp: Date.now()});
};

HmiExpr.Evaluator.prototype.eval_return = function(node)
{
	throw new HmiExpr.ReturnSignal((node.value != null) ? this.run(node.value) :
		HmiExpr.quickDefault());
};

HmiExpr.Evaluator.prototype.resume = function(last)
{
	var frames = this.frames;

	while (frames.length > 0)
	{
		var frame = frames[frames.length - 1];

		if (frame.i >= frame.body.length)
		{
			// A loop's frame is the whole of its state, so a pass that paused
			// at an asynchronous call carries on here as any other would
			if (frame.loop != null && this.loopAgain(frame))
			{
				frame.i = 0;
				continue;
			}

			frames.pop();
			continue;
		}

		var statement = frame.body[frame.i++];

		if (statement.type === 'while' || statement.type === 'for')
		{
			var entry = this.loopEntry(statement);
			last = entry.last;

			if (entry.frame != null)
			{
				frames.push(entry.frame);
			}

			continue;
		}

		if (statement.type === 'if')
		{
			var cond = this.run(statement.condition);

			// See eval_if: bad data takes neither branch
			if (cond.quality <= HmiTypes.QUALITY_BAD)
			{
				last = {value: null, quality: HmiTypes.QUALITY_BAD, timestamp: cond.timestamp};
				continue;
			}

			frames.push({body: (HmiExpr.truthy(cond.value)) ? statement.then : statement.otherwise, i: 0});
			last = {value: null, quality: cond.quality, timestamp: cond.timestamp};
			continue;
		}

		var call = HmiExpr.asyncCallOf(statement);

		if (call != null)
		{
			return this.suspend(statement, call);
		}

		last = this.run(statement);
	}

	return last;
};

HmiExpr.Evaluator.prototype.suspend = function(statement, call)
{
	var args = [];

	for (var i = 0; i < call.args.length; i++)
	{
		args.push(this.run(call.args[i]).value);
	}

	var that = this;
	var ctx = this.ctx;

	if (ctx.callAsync == null)
	{
		throw new HmiExpr.RuntimeError(call.name + '() is not available here');
	}

	var called = false;

	ctx.callAsync(call.name, args, function(value)
	{
		if (called)
		{
			return;
		}

		called = true;

		try
		{
			if (statement.type === 'assign')
			{
				that.assign(statement.target, {value: value, quality: HmiTypes.QUALITY_GOOD, timestamp: Date.now()});
			}

			that.resume({value: value, quality: HmiTypes.QUALITY_GOOD, timestamp: Date.now()});
		}
		catch (e)
		{
			if (ctx.scriptError != null)
			{
				ctx.scriptError((e != null) ? e.message : 'evaluation failed');
			}
		}
	});

	return {value: null, quality: HmiTypes.QUALITY_GOOD, timestamp: Date.now(), suspended: true};
};

// ------------------------------------------------------------------ cache

HmiExpr.cache = {};
HmiExpr.cacheKeys = [];
HmiExpr.CACHE_MAX = 500;

HmiExpr.cacheKey = function(src, opts)
{
	// The dictionary takes part in compilation (unknown tags are errors), so
	// the key carries both which dictionary and which version of it.
	var project = (opts != null) ? opts.project : null;
	var stamp = (project != null) ?
		(project.uid + '#' + project.revision) : 'none';

	var mode = (opts != null) ? opts.mode : null;
	var prefix = (mode === 'script') ? 's:' : ((mode === 'quick') ? 'q:' : 'e:');
	// A QuickFunction's arguments are not in its body's text, and renaming
	// one changes what the same text means.
	var args = (opts != null && opts.fn != null) ?
		HmiQuickFn.argsKey(opts.fn) + '\u0000' : '';

	return prefix + stamp + ':' + args + src;
};

HmiExpr.clearCache = function()
{
	HmiExpr.cache = {};
	HmiExpr.cacheKeys = [];
};

// ---------------------------------------------------------------- compile

/**
 * @param {string} src
 * @param {{mode:string, project:HmiProject}} opts
 * @returns {{src, ast, deps, writes, errors, eval}}
 */
HmiExpr.compile = function(src, opts)
{
	opts = opts || {};

	var key = HmiExpr.cacheKey(src, opts);
	var hit = HmiExpr.cache[key];

	if (hit != null)
	{
		return hit;
	}

	var lexer = new HmiExpr.Lexer(src).run();
	var parser = new HmiExpr.Parser(lexer.tokens, opts);
	var ast;

	if (HmiExpr.isStatements(opts.mode))
	{
		ast = parser.parseScript();
	}
	else
	{
		ast = parser.parseExpression();
	}

	var errors = lexer.errors.concat(parser.errors);

	var compiled = {
		src: src,
		ast: ast,
		deps: parser.deps,
		writes: parser.writes,
		errors: errors,

		// Statements that write a tag or act: a QuickFunction made of them
		// belongs in a script, never in an animation link
		impure: HmiExpr.isStatements(opts.mode) && (parser.writes.length > 0 ||
			parser.callsAction || parser.callsImpure),
		args: (opts.fn != null && opts.fn.args != null) ? opts.fn.args : [],

		/**
		 * Evaluation never throws. A failure returns bad quality so the link
		 * applies its bad-quality treatment rather than taking down the
		 * render loop.
		 */
		eval: function(ctx)
		{
			if (errors.length > 0)
			{
				return {value: null, quality: HmiTypes.QUALITY_BAD,
					timestamp: Date.now(), error: errors[0].message};
			}

			try
			{
				return new HmiExpr.Evaluator(ctx,
					{project: opts.project}).run(ast);
			}
			catch (e)
			{
				return {value: null, quality: HmiTypes.QUALITY_BAD,
					timestamp: Date.now(),
					error: (e != null) ? e.message : 'evaluation failed'};
			}
		}
	};

	HmiExpr.cache[key] = compiled;
	HmiExpr.cacheKeys.push(key);

	while (HmiExpr.cacheKeys.length > HmiExpr.CACHE_MAX)
	{
		delete HmiExpr.cache[HmiExpr.cacheKeys.shift()];
	}

	return compiled;
};

/** Convenience for callers that only want the tag names. */
HmiExpr.dependencies = function(src, project)
{
	if (src == null || src === '')
	{
		return [];
	}

	return HmiExpr.compile(src, {project: project}).deps;
};
