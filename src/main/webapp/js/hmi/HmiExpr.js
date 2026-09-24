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

/** Word operators, matched case-insensitively on a whole token. */
HmiExpr.WORD_OPS = {AND: 'AND', OR: 'OR', NOT: 'NOT', MOD: 'MOD'};

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
	'Text': {arity: 2, fn: function(a, b) { return HmiExpr.picture(HmiExpr.num(a), '' + b); }}
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
		statements.push(this.parseStatement());

		if (!this.eatOp(';') && this.peek().type !== HmiExpr.T.END)
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
	var start = this.i;
	var node = this.parseOr();

	if (this.atOp('='))
	{
		this.next();

		if (node.type !== 'ref')
		{
			this.error('only a tag can be assigned to', this.tokens[start]);
		}
		else if (node.field != null && node.field !== 'Value')
		{
			this.error('cannot assign to .' + node.field, this.tokens[start]);
		}
		else if (mxUtils.indexOf(this.writes, node.name) < 0)
		{
			this.writes.push(node.name);
		}

		return {type: 'assign', target: node, value: this.parseOr()};
	}

	return {type: 'expr', value: node};
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
	if (this.project != null && name.charAt(0) !== '$' &&
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
	else if (args.length !== def.arity)
	{
		this.error(name + ' takes ' + def.arity + ' argument' +
			((def.arity === 1) ? '' : 's') + ', got ' + args.length, token);
	}

	return {type: 'call', name: name, args: args};
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

	return {value: def.fn.apply(null, args), quality: meta.quality,
		timestamp: meta.timestamp};
};

HmiExpr.Evaluator.prototype.eval_assign = function(node)
{
	var v = this.run(node.value);

	if (this.ctx.write != null)
	{
		this.ctx.write(node.target.name, v.value);
	}

	return v;
};

HmiExpr.Evaluator.prototype.eval_expr = function(node)
{
	return this.run(node.value);
};

HmiExpr.Evaluator.prototype.eval_script = function(node)
{
	var last = {value: null, quality: HmiTypes.QUALITY_GOOD,
		timestamp: Date.now()};

	for (var i = 0; i < node.body.length; i++)
	{
		last = this.run(node.body[i]);
	}

	return last;
};

// ------------------------------------------------------------------ cache

HmiExpr.cache = {};
HmiExpr.cacheKeys = [];
HmiExpr.CACHE_MAX = 500;

HmiExpr.cacheKey = function(src, opts)
{
	// The dictionary takes part in compilation (unknown tags are errors), so
	// a project edit must not be served a stale compile.
	var stamp = (opts != null && opts.project != null) ?
		opts.project.revision : 'none';

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
