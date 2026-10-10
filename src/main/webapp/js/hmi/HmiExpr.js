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

/** Tag names are limited to 63 characters, as in InTouch. */
HmiExpr.MAX_NAME = 63;

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
	'ScreenToPDF': {arity: 0, action: true}
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

	if (node.type === 'call' && HmiExpr.FUNCTIONS[node.name] != null && HmiExpr.FUNCTIONS[node.name].async)
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

	return (call != null && call.type === 'call' && HmiExpr.FUNCTIONS[call.name] != null &&
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

		// "ENDIF;" is the InTouch spelling, but a bare ENDIF is unambiguous
		// so it is not worth rejecting.
		if (!this.eatOp(';') && this.peek().type !== HmiExpr.T.END &&
			statement.type !== 'if')
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
	if (this.atOp('IF'))
	{
		return this.parseIf();
	}

	var start = this.i;
	var node = this.parseOr();

	if (this.atOp('='))
	{
		this.next();

		var system = (node.type === 'ref') ? HmiTypes.SYSTEM_TAGS[node.name] : null;

		if (node.type !== 'ref')
		{
			this.error('only a tag can be assigned to', this.tokens[start]);
		}
		// Writing 1 to .Acked acknowledges the tag's alarm; no other field
		// can be written
		else if (node.field != null && node.field !== 'Value' && node.field !== 'Acked')
		{
			this.error('cannot assign to .' + node.field, this.tokens[start]);
		}
		else if (system != null && system.readOnly)
		{
			this.error(node.name + ' is read-only', this.tokens[start]);
		}
		else if (mxUtils.indexOf(this.writes, node.name) < 0)
		{
			this.writes.push(node.name);
		}

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
 * An asynchronous function (ShowRecipeSelect) pauses the script, so it can
 * only be a statement of its own or the whole value of an assignment.
 */
HmiExpr.Parser.prototype.checkAsync = function(statement, token)
{
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

	this.error(name + '() must be a statement or the value of an assignment', token);
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

	return {type: 'if', condition: condition, then: then, otherwise: otherwise};
};

HmiExpr.Parser.prototype.atAnyOp = function(ops)
{
	for (var i = 0; i < ops.length; i++)
	{
		if (this.atOp(ops[i]))
		{
			return true;
		}
	}

	return false;
};

HmiExpr.Parser.prototype.parseStatementsUntil = function(stops)
{
	var body = [];

	while (this.peek().type !== HmiExpr.T.END && !this.atAnyOp(stops))
	{
		var before = this.i;
		var statement = this.parseStatement();
		body.push(statement);

		// A branch's statements end in ';', but the last one before ELSE or
		// ENDIF may omit it, and a nested IF needs none after its ENDIF.
		if (!this.eatOp(';') && !this.atAnyOp(stops) &&
			this.peek().type !== HmiExpr.T.END && statement.type !== 'if')
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
	if (this.atOp('=') && this.opts.mode !== 'script')
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
	else if (def.action && this.opts.mode !== 'script')
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

	return {type: 'call', name: name, args: args};
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

HmiExpr.Evaluator = function(ctx)
{
	this.ctx = ctx;
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

HmiExpr.Evaluator.prototype.eval_assign = function(node)
{
	var v = this.run(node.value);

	if (this.ctx.write != null)
	{
		this.ctx.write(node.target.name, v.value, node.target.field);
	}

	return v;
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
	this.frames = [{body: node.body, i: 0}];

	return this.resume({value: null, quality: HmiTypes.QUALITY_GOOD, timestamp: Date.now()});
};

HmiExpr.Evaluator.prototype.resume = function(last)
{
	var frames = this.frames;

	while (frames.length > 0)
	{
		var frame = frames[frames.length - 1];

		if (frame.i >= frame.body.length)
		{
			frames.pop();
			continue;
		}

		var statement = frame.body[frame.i++];

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
			if (statement.type === 'assign' && ctx.write != null)
			{
				ctx.write(statement.target.name, value, statement.target.field);
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

	return ((opts != null && opts.mode === 'script') ? 's:' : 'e:') +
		stamp + ':' + src;
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

	if (opts.mode === 'script')
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
				return new HmiExpr.Evaluator(ctx).run(ast);
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
