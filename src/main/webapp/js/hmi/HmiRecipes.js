/**
 * Recipes: named sets of tag values, kept in Recipe Books.
 *
 * A book (HMI > Recipes, project.recipeBooks) lists its Save/Load tags and,
 * when uploadDownload is set, an Upload/Download tag paired with each, plus
 * starting recipes. At run time one HmiRecipeManager per Run answers the
 * script functions RecipeSave, RecipeLoad, RecipeUpload, RecipeDownload,
 * RecipeExport, RecipeImport, RecipeDelete, RecipeRename and
 * ShowRecipeSelect. Recipes saved at run time are kept on the PC running the
 * application (userData/recipes/<store>.json) and replace a book's starting
 * recipes there. A failed function returns 0 and tells the operator why in
 * the Recipe Error window.
 *
 * The Recipe List object (shape=hmiRecipeList) shows a book's recipes at Run;
 * its settings are the hidden recipeList link.
 */
HmiRecipes = function() {};

HmiRecipes.LIST_SHAPE = 'hmiRecipeList';
HmiRecipes.MAX_NAME = 64;
HmiRecipes.SAVE_DELAY_MS = 300;
HmiRecipes.REFRESH_MS = 5000;

// Names of the functions a manager answers (HmiRuntime.context routes them)
HmiRecipes.FUNCTIONS = ['RecipeSave', 'RecipeLoad', 'RecipeUpload', 'RecipeDownload', 'RecipeExport',
	'RecipeImport', 'RecipeDelete', 'RecipeRename', 'ShowRecipeSelect'];

HmiRecipes.isFunction = function(name)
{
	return mxUtils.indexOf(HmiRecipes.FUNCTIONS, name) >= 0;
};

// ------------------------------------------------------------------ helpers

/** Book, recipe names: 1 to 64 characters, no control characters. */
HmiRecipes.validName = function(name)
{
	return typeof name === 'string' && name.trim() !== '' && name.length <= HmiRecipes.MAX_NAME &&
		!/[\x00-\x1f\x7f]/.test(name);
};

HmiRecipes.findBook = function(books, name)
{
	var key = String(name).toLowerCase();

	for (var i = 0; i < books.length; i++)
	{
		if (books[i].name.toLowerCase() === key)
		{
			return books[i];
		}
	}

	return null;
};

/** The key of map matching name case-insensitively, or null. */
HmiRecipes.findKey = function(map, name)
{
	var key = String(name).toLowerCase();

	for (var k in map)
	{
		if (k.toLowerCase() === key)
		{
			return k;
		}
	}

	return null;
};

HmiRecipes.copyBooks = function(books)
{
	return JSON.parse(JSON.stringify(books || []));
};

HmiRecipes.newBook = function(name)
{
	return {name: name, uploadDownload: false, items: [], recipes: {}};
};

HmiRecipes.sortedNames = function(recipes)
{
	return Object.keys(recipes || {}).sort(function(a, b)
	{
		return a.toLowerCase() < b.toLowerCase() ? -1 : (a.toLowerCase() > b.toLowerCase() ? 1 : 0);
	});
};

/** Problems with a book's tags in a project, as messages. */
HmiRecipes.bookProblems = function(project, book)
{
	var problems = [];
	var seen = {};

	for (var i = 0; i < book.items.length; i++)
	{
		var item = book.items[i];
		var tags = [item.tag].concat((book.uploadDownload && item.ioTag) ? [item.ioTag] : []);

		if (!item.tag)
		{
			problems.push('row ' + (i + 1) + ' has no Save/Load tag');
		}

		for (var j = 0; j < tags.length; j++)
		{
			if (!tags[j])
			{
				continue;
			}

			var tag = project.getTag(tags[j]);

			if (tag == null)
			{
				problems.push('unknown tag "' + tags[j] + '"');
			}

			if (j === 0)
			{
				if (seen[tags[j].toLowerCase()])
				{
					problems.push('"' + tags[j] + '" is listed twice');
				}

				seen[tags[j].toLowerCase()] = true;
			}
		}
	}

	return problems;
};

// ---------------------------------------------------------------- CSV files

HmiRecipes.csvCell = function(v)
{
	var s = (v == null) ? '' : String(v);

	return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/** One CSV record; quoted fields may hold commas and quotes. */
HmiRecipes.parseCsvLine = function(line)
{
	var cells = [];
	var cur = '';
	var quoted = false;

	for (var i = 0; i < line.length; i++)
	{
		var ch = line.charAt(i);

		if (quoted)
		{
			if (ch === '"' && line.charAt(i + 1) === '"')
			{
				cur += '"';
				i++;
			}
			else if (ch === '"')
			{
				quoted = false;
			}
			else
			{
				cur += ch;
			}
		}
		else if (ch === '"')
		{
			quoted = true;
		}
		else if (ch === ',')
		{
			cells.push(cur);
			cur = '';
		}
		else
		{
			cur += ch;
		}
	}

	cells.push(cur);

	return cells;
};

/**
 * #Recipe,<book>,<name>
 * Tag,Value
 * <tag>,<value> ...
 */
HmiRecipes.toCsv = function(book, name, values, order)
{
	var lines = ['#Recipe,' + HmiRecipes.csvCell(book) + ',' + HmiRecipes.csvCell(name), 'Tag,Value'];
	var tags = (order != null) ? order.slice(0) : [];

	for (var tag in values)
	{
		if (mxUtils.indexOf(tags, tag) < 0)
		{
			tags.push(tag);
		}
	}

	for (var i = 0; i < tags.length; i++)
	{
		if (values[tags[i]] !== undefined)
		{
			lines.push(HmiRecipes.csvCell(tags[i]) + ',' + HmiRecipes.csvCell(values[tags[i]]));
		}
	}

	return lines.join('\r\n') + '\r\n';
};

/** {values: {tag: text}, errors: [message]} from a recipe CSV. */
HmiRecipes.fromCsv = function(text)
{
	var lines = String(text).replace(/^﻿/, '').split(/\r\n|\n|\r/);
	var values = {};
	var errors = [];
	var header = false;

	for (var i = 0; i < lines.length; i++)
	{
		var line = lines[i];

		if (line.trim() === '' || /^#/.test(line))
		{
			continue;
		}

		var cells = HmiRecipes.parseCsvLine(line);

		if (!header && cells[0].trim().toLowerCase() === 'tag')
		{
			header = true;
			continue;
		}

		if (cells.length < 2 || cells[0].trim() === '')
		{
			errors.push('Line ' + (i + 1) + ': expected a tag and a value.');
			continue;
		}

		values[cells[0].trim()] = cells[1];
	}

	return {values: values, errors: errors};
};

// ------------------------------------------------------------------ storage

HmiRecipes.available = function()
{
	return window.electron != null && typeof window.electron.request === 'function';
};

/** The PC's saved recipes, to fn(books or null). */
HmiRecipes.load = function(store, fn)
{
	if (!store || !HmiRecipes.available())
	{
		fn(null);

		return;
	}

	window.electron.request({action: 'hmiRecipes.load', store: store}, function(books)
	{
		fn(books || null);
	}, function(message)
	{
		HmiLog.warn('recipes not read: ' + message);
		fn(null);
	});
};

HmiRecipes.clear = function(store, fn)
{
	window.electron.request({action: 'hmiRecipes.clear', store: store}, function() { fn(null); },
		function(message) { fn(message); });
};

HmiRecipes.log = function(level, message)
{
	HmiLog.log('recipes: ' + message);

	if (typeof HmiRuntimeApp !== 'undefined' && HmiRuntimeApp.isActive())
	{
		HmiRuntimeApp.log(level, message);
	}
};

/** `RecipeLoad("Book", "")`: how a call is named in the Recipe Error window. */
HmiRecipes.describeCall = function(name, args)
{
	return name + '(' + args.map(function(a)
	{
		return (typeof a === 'string') ? '"' + a + '"' : String(a);
	}).join(', ') + ')';
};

// ================================================================= manager

/**
 * @param project  the HmiProject
 * @param driver   a hub client: values of the books' tags, and writes
 * @param options  {ui, store, saved (the PC's books, or null), persist(books)
 *                 (default: the main process), loadSaved(fn(books)): what the
 *                 PC has now (default: the main process when persist is not
 *                 given), refreshMs (default: every few seconds in Append HMI
 *                 Web, never elsewhere), files ({exportCsv(name, text,
 *                 fn(error, file)), importCsv(fn(error, {text}))}: default the
 *                 main process, or the browser in Append HMI Web), report
 *                 (call, message): the Recipe Error window by default}
 */
HmiRecipeManager = function(project, driver, options)
{
	this.project = project;
	this.driver = driver;
	this.options = options || {};
	this.values = {};
	this.listeners = {change: []};
	this.pendingWrites = {};

	// The PC's recipes replace a book's starting recipes, book by book
	var saved = this.options.saved || {};
	this.savedBooks = {};
	this.books = HmiRecipes.copyBooks(project.recipeBooks);

	for (var i = 0; i < this.books.length; i++)
	{
		var key = HmiRecipes.findKey(saved, this.books[i].name);

		if (key != null)
		{
			this.books[i].recipes = JSON.parse(JSON.stringify(saved[key]));
			this.savedBooks[this.books[i].name] = true;
		}
	}

	this.synced = this.snapshot();
};

HmiRecipeManager.prototype.on = function(event, fn)
{
	(this.listeners[event] = this.listeners[event] || []).push(fn);
};

HmiRecipeManager.prototype.off = function(event, fn)
{
	var list = this.listeners[event] || [];
	var i = mxUtils.indexOf(list, fn);

	if (i >= 0)
	{
		list.splice(i, 1);
	}
};

HmiRecipeManager.prototype.fire = function(event, arg)
{
	var list = (this.listeners[event] || []).slice(0);

	for (var i = 0; i < list.length; i++)
	{
		list[i](arg);
	}
};

/** Every tag a book reads or writes. */
HmiRecipeManager.prototype.tagNames = function()
{
	var names = [];

	for (var i = 0; i < this.books.length; i++)
	{
		var b = this.books[i];

		for (var j = 0; j < b.items.length; j++)
		{
			var pair = [b.items[j].tag].concat(b.uploadDownload ? [b.items[j].ioTag] : []);

			for (var k = 0; k < pair.length; k++)
			{
				if (pair[k] && this.project.getTag(pair[k]) != null && mxUtils.indexOf(names, pair[k]) < 0)
				{
					names.push(pair[k]);
				}
			}
		}
	}

	return names;
};

HmiRecipeManager.prototype.start = function()
{
	var that = this;
	this.running = true;
	this.onChange = function(batch)
	{
		for (var name in batch)
		{
			that.values[name.toLowerCase()] = batch[name];
		}
	};
	this.onWriteError = function(e) { that.writeError(e); };
	this.driver.on('change', this.onChange);
	this.driver.on('writeError', this.onWriteError);

	var names = this.tagNames();

	if (names.length > 0)
	{
		this.driver.subscribe(names, 250);
	}

	// Each browser of Append HMI Web has its own manager: what the others
	// save reaches it here
	var web = window.electron != null && window.electron.hmiWeb === true;
	var refreshMs = (this.options.refreshMs != null) ? this.options.refreshMs : (web ? HmiRecipes.REFRESH_MS : 0);

	if (refreshMs > 0 && this.loader() != null)
	{
		this.refreshTimer = window.setInterval(function() { that.refresh(); }, refreshMs);
	}
};

HmiRecipeManager.prototype.stop = function()
{
	if (!this.running)
	{
		return;
	}

	this.running = false;

	if (this.refreshTimer != null)
	{
		window.clearInterval(this.refreshTimer);
		this.refreshTimer = null;
	}

	this.driver.off('change', this.onChange);
	this.driver.off('writeError', this.onWriteError);
	this.flush();
};

/** A tag's current value: what the books' subscription delivered. */
HmiRecipeManager.prototype.read = function(name)
{
	var v = this.values[name.toLowerCase()];

	if (v == null && this.driver.get != null)
	{
		v = this.driver.get(name);
	}

	return (v != null) ? v : {value: null, quality: HmiTypes.QUALITY_BAD, timestamp: 0};
};

HmiRecipeManager.prototype.bookNames = function()
{
	return this.books.map(function(b) { return b.name; });
};

/** A book's recipe names, sorted; [] for an unknown book. */
HmiRecipeManager.prototype.recipeNames = function(book)
{
	var b = HmiRecipes.findBook(this.books, book);

	return (b != null) ? HmiRecipes.sortedNames(b.recipes) : [];
};

HmiRecipeManager.prototype.recipe = function(book, name)
{
	var b = HmiRecipes.findBook(this.books, book);
	var key = (b != null) ? HmiRecipes.findKey(b.recipes, name) : null;

	return (key != null) ? b.recipes[key] : null;
};

// ------------------------------------------------------------------ saving

HmiRecipeManager.prototype.changed = function(book)
{
	this.savedBooks[book.name] = true;
	this.fire('change', book.name);

	var that = this;

	if (this.saveTimer != null)
	{
		window.clearTimeout(this.saveTimer);
	}

	this.saveTimer = window.setTimeout(function()
	{
		that.flush();
	}, HmiRecipes.SAVE_DELAY_MS);
};

/** The books the PC keeps: those changed at run time or saved before. */
HmiRecipeManager.prototype.toSave = function()
{
	var out = {};

	for (var i = 0; i < this.books.length; i++)
	{
		if (this.savedBooks[this.books[i].name])
		{
			out[this.books[i].name] = JSON.parse(JSON.stringify(this.books[i].recipes));
		}
	}

	return out;
};

/** Every book's recipes as they are now: {book: {recipe: {tag: value}}}. */
HmiRecipeManager.prototype.snapshot = function()
{
	var out = {};

	for (var i = 0; i < this.books.length; i++)
	{
		out[this.books[i].name] = JSON.parse(JSON.stringify(this.books[i].recipes));
	}

	return out;
};

/** How the PC's saved recipes are fetched, or null to save without merging. */
HmiRecipeManager.prototype.loader = function()
{
	var that = this;

	if (this.options.loadSaved != null)
	{
		return this.options.loadSaved;
	}

	if (this.options.persist == null && this.options.store && HmiRecipes.available())
	{
		return function(fn) { HmiRecipes.load(that.options.store, fn); };
	}

	return null;
};

/**
 * Saving merges: what the PC has now, with only this manager's own changes
 * since it last synchronized (added, replaced, renamed and deleted recipes)
 * on top. Another browser of Append HMI Web, or another window, may have
 * saved in the meantime; its recipes are kept.
 */
HmiRecipeManager.prototype.flush = function()
{
	if (this.saveTimer == null)
	{
		return;
	}

	window.clearTimeout(this.saveTimer);
	this.saveTimer = null;

	var load = this.loader();
	var that = this;

	if (load == null)
	{
		if (this.options.persist != null)
		{
			this.options.persist(this.toSave());
		}

		return;
	}

	if (this.saving)
	{
		this.saveAgain = true;

		return;
	}

	this.saving = true;

	load(function(saved)
	{
		var books = that.merge(saved || {});
		var done = function()
		{
			that.saving = false;

			if (that.saveAgain)
			{
				that.saveAgain = false;
				that.saveTimer = 0;
				that.flush();
			}
		};

		if (that.options.persist != null)
		{
			that.options.persist(books);
			done();
		}
		else
		{
			window.electron.request({action: 'hmiRecipes.save', store: that.options.store, books: books},
				done, function(message)
			{
				that.report('', 'The recipes could not be saved on this computer: ' + message + '.');
				done();
			});
		}
	});
};

/** The books to save: saved, with this manager's changes applied. Adopts the result. */
HmiRecipeManager.prototype.merge = function(saved)
{
	var out = JSON.parse(JSON.stringify(saved));
	var now = this.snapshot();

	for (var i = 0; i < this.books.length; i++)
	{
		var b = this.books[i];

		if (!this.savedBooks[b.name])
		{
			continue;
		}

		var before = this.synced[b.name] || {};
		var local = now[b.name];
		var key = HmiRecipes.findKey(out, b.name);
		var merged = (key != null) ? out[key] : JSON.parse(JSON.stringify(before));
		var name, k;

		for (name in before)
		{
			if (!local.hasOwnProperty(name) && (k = HmiRecipes.findKey(merged, name)) != null)
			{
				delete merged[k];
			}
		}

		for (name in local)
		{
			if (!before.hasOwnProperty(name) || JSON.stringify(before[name]) !== JSON.stringify(local[name]))
			{
				if ((k = HmiRecipes.findKey(merged, name)) != null)
				{
					delete merged[k];
				}

				merged[name] = local[name];
			}
		}

		if (key != null && key !== b.name)
		{
			delete out[key];
		}

		out[b.name] = merged;
	}

	this.adopt(out);

	return out;
};

/** Takes the PC's recipes for every book it has; fires change for those that differ. */
HmiRecipeManager.prototype.adopt = function(saved)
{
	for (var i = 0; i < this.books.length; i++)
	{
		var b = this.books[i];
		var key = HmiRecipes.findKey(saved, b.name);

		if (key != null)
		{
			var differs = JSON.stringify(b.recipes) !== JSON.stringify(saved[key]);
			b.recipes = JSON.parse(JSON.stringify(saved[key]));
			this.savedBooks[b.name] = true;

			if (differs)
			{
				this.fire('change', b.name);
			}
		}
	}

	this.synced = this.snapshot();
};

/** Append HMI Web: picks up what other browsers saved, unless a save is due. */
HmiRecipeManager.prototype.refresh = function(fn)
{
	var load = this.loader();
	var that = this;

	if (load == null || this.saving || this.saveTimer != null || this.refreshing)
	{
		if (fn != null) fn(false);

		return;
	}

	this.refreshing = true;

	load(function(saved)
	{
		that.refreshing = false;

		if (saved != null && that.running !== false && !that.saving && that.saveTimer == null)
		{
			that.adopt(saved);
		}

		if (fn != null) fn(saved != null);
	});
};

// ------------------------------------------------------------------ errors

/** A failure: logged, shown in the Recipe Error window, and 0 returned. */
HmiRecipeManager.prototype.fail = function(call, message)
{
	this.report(call, message);

	return 0;
};

HmiRecipeManager.prototype.report = function(call, message)
{
	HmiRecipes.log('warn', (call ? call + ': ' : '') + message);
	this.lastError = message;

	if (this.options.report != null)
	{
		this.options.report(call, message);
	}
	else if (this.options.ui != null)
	{
		HmiDialogs.queueRecipeError(this.options.ui, call, message);
	}
};

/** A device's refusal of a write a recipe function made. */
HmiRecipeManager.prototype.writeError = function(e)
{
	var key = (e != null && e.name != null) ? String(e.name).toLowerCase() : null;
	var pending = (key != null) ? this.pendingWrites[key] : null;

	if (pending != null && Date.now() - pending.at < 15000)
	{
		delete this.pendingWrites[key];
		this.report(pending.call, 'Could not write ' + e.name + ': ' + (e.error || 'refused by the device') + '.');
	}
};

/** Text argument: trimmed, or null after reporting why not. */
HmiRecipeManager.prototype.textArg = function(call, value, what)
{
	if (value == null || (typeof value !== 'string' && typeof value !== 'number'))
	{
		this.fail(call, 'The ' + what + ' must be text.');

		return null;
	}

	var text = String(value).trim();

	if (text === '')
	{
		this.fail(call, 'The ' + what + ' is empty.');

		return null;
	}

	if (!HmiRecipes.validName(text))
	{
		this.fail(call, (what === 'recipe book name') ? 'Recipe book names can have up to 64 characters.' :
			'Recipe names can have up to 64 characters, without control characters.');

		return null;
	}

	return text;
};

/** The book, checked; null after reporting why not. */
HmiRecipeManager.prototype.bookArg = function(call, value, needUpload)
{
	var name = this.textArg(call, value, 'recipe book name');

	if (name == null)
	{
		return null;
	}

	var book = HmiRecipes.findBook(this.books, name);

	if (book == null)
	{
		this.fail(call, 'There is no recipe book named "' + name + '".');

		return null;
	}

	var missing = [];

	for (var i = 0; i < book.items.length; i++)
	{
		var tags = [book.items[i].tag].concat((needUpload && book.uploadDownload) ? [book.items[i].ioTag] : []);

		for (var j = 0; j < tags.length; j++)
		{
			if (tags[j] && this.project.getTag(tags[j]) == null && mxUtils.indexOf(missing, tags[j]) < 0)
			{
				missing.push(tags[j]);
			}
		}
	}

	if (missing.length > 0)
	{
		this.fail(call, 'The recipe book "' + book.name + '" uses tags that no longer exist: ' +
			HmiRecipes.listText(missing) + '.');

		return null;
	}

	if (needUpload && (!book.uploadDownload || !book.items.some(function(it) { return it.ioTag; })))
	{
		this.fail(call, 'The recipe book "' + book.name + '" has no Upload/Download tags.');

		return null;
	}

	return book;
};

HmiRecipes.listText = function(names, max)
{
	max = max || 8;

	return names.slice(0, max).join(', ') + ((names.length > max) ? ' and ' + (names.length - max) + ' more' : '');
};

HmiRecipeManager.prototype.recipeKey = function(call, book, name)
{
	var key = HmiRecipes.findKey(book.recipes, name);

	if (key == null)
	{
		this.fail(call, 'There is no recipe named "' + name + '" in "' + book.name + '".');
	}

	return key;
};

/** Good values of tags, or null after reporting the bad ones. */
HmiRecipeManager.prototype.readGood = function(call, tags)
{
	var values = {};
	var bad = [];

	for (var i = 0; i < tags.length; i++)
	{
		var v = this.read(tags[i]);

		if (v.quality <= HmiTypes.QUALITY_BAD || v.value == null)
		{
			bad.push(tags[i]);
		}
		else
		{
			values[tags[i]] = v.value;
		}
	}

	if (bad.length > 0)
	{
		this.fail(call, 'These tags have no good value: ' + HmiRecipes.listText(bad) +
			' (the PLC may not be connected).');

		return null;
	}

	return values;
};

/** Writes {tag: value}, each made to fit its tag; 1, or 0 after reporting. */
HmiRecipeManager.prototype.writeAll = function(call, values)
{
	var writes = {};
	var failed = [];

	for (var name in values)
	{
		var tag = this.project.getTag(name);
		var v = (tag != null) ? HmiSimulator.coerce(tag, values[name]) : null;

		if (tag == null)
		{
			failed.push('Could not write ' + name + ': unknown tag.');
		}
		else if (v == null)
		{
			failed.push('Could not write ' + name + ': "' + values[name] + '" is not a number.');
		}
		else
		{
			writes[tag.name] = v;
		}
	}

	var results = (Object.keys(writes).length > 0) ? (this.driver.write(writes) || {}) : {};

	for (var w in writes)
	{
		var r = results[w];

		if (r != null && r.ok === false)
		{
			failed.push('Could not write ' + w + ': ' + (r.error || 'refused') + '.');
		}
		else if (r != null && r.pending)
		{
			this.pendingWrites[w.toLowerCase()] = {call: call, at: Date.now()};
		}
	}

	if (failed.length > 0)
	{
		return this.fail(call, failed.join('\n'));
	}

	return 1;
};

// ------------------------------------------------------------- functions

/** The script functions (HmiRuntime.context routes them here). */
HmiRecipeManager.prototype.call = function(name, args)
{
	var call = HmiRecipes.describeCall(name, args);

	switch (name)
	{
		case 'RecipeSave': return this.save(call, args[0], args[1]);
		case 'RecipeLoad': return this.loadRecipe(call, args[0], args[1]);
		case 'RecipeUpload': return this.upload(call, args[0]);
		case 'RecipeDownload': return this.download(call, args[0]);
		case 'RecipeExport': return this.exportRecipe(call, args[0], args[1]);
		case 'RecipeImport': return this.importRecipe(call, args[0], args[1]);
		case 'RecipeDelete': return this.deleteRecipe(call, args[0], args[1], args[2]);
		case 'RecipeRename': return this.rename(call, args[0], args[1], args[2]);
	}

	return null;
};

/** ShowRecipeSelect: done(name, or '' on Cancel or failure). */
HmiRecipeManager.prototype.callAsync = function(name, args, done)
{
	var call = HmiRecipes.describeCall(name, args);
	var book = this.bookArg(call, args[0]);

	if (book == null)
	{
		done('');

		return;
	}

	var rect = null;

	if (args.length >= 5)
	{
		rect = {x: Number(args[1]), y: Number(args[2]), width: Number(args[3]), height: Number(args[4])};

		if (!(rect.width > 0 && rect.height > 0 && isFinite(rect.x) && isFinite(rect.y)))
		{
			this.report(call, 'The window position and size must be numbers, the size above 0.');
			rect = null;
		}
	}
	else if (args.length >= 3)
	{
		rect = {x: Number(args[1]), y: Number(args[2])};

		if (!(isFinite(rect.x) && isFinite(rect.y)))
		{
			rect = null;
		}
	}

	if (this.options.select != null)
	{
		this.options.select(book.name, HmiRecipes.sortedNames(book.recipes), rect, done);
	}
	else if (this.options.ui != null)
	{
		HmiDialogs.showRecipeSelect(this.options.ui, this, book.name, rect, done);
	}
	else
	{
		done('');
	}
};

HmiRecipeManager.prototype.save = function(call, bookArg, nameArg)
{
	var book = this.bookArg(call, bookArg);
	var name = (book != null) ? this.textArg(call, nameArg, 'recipe name') : null;

	if (name == null)
	{
		return 0;
	}

	var values = this.readGood(call, book.items.map(function(it) { return it.tag; }).filter(Boolean));

	if (values == null)
	{
		return 0;
	}

	var key = HmiRecipes.findKey(book.recipes, name);

	if (key != null)
	{
		delete book.recipes[key];
	}

	book.recipes[name] = values;
	HmiRecipes.log('info', 'saved recipe "' + name + '" in "' + book.name + '"');
	this.changed(book);

	return 1;
};

HmiRecipeManager.prototype.loadRecipe = function(call, bookArg, nameArg)
{
	var book = this.bookArg(call, bookArg);
	var name = (book != null) ? this.textArg(call, nameArg, 'recipe name') : null;
	var key = (name != null) ? this.recipeKey(call, book, name) : null;

	if (key == null)
	{
		return 0;
	}

	var stored = book.recipes[key];
	var values = {};

	// Only the book's tags, in the book's order; a tag added to the book
	// after the recipe was saved keeps its value
	for (var i = 0; i < book.items.length; i++)
	{
		var k = HmiRecipes.findKey(stored, book.items[i].tag);

		if (book.items[i].tag && k != null)
		{
			values[book.items[i].tag] = stored[k];
		}
	}

	var ok = this.writeAll(call, values);

	if (ok)
	{
		HmiRecipes.log('info', 'loaded recipe "' + key + '" from "' + book.name + '"');
	}

	return ok;
};

/** Upload/Download tag values into the Save/Load tags. */
HmiRecipeManager.prototype.upload = function(call, bookArg)
{
	var book = this.bookArg(call, bookArg, true);

	if (book == null)
	{
		return 0;
	}

	var pairs = book.items.filter(function(it) { return it.tag && it.ioTag; });
	var read = this.readGood(call, pairs.map(function(it) { return it.ioTag; }));

	if (read == null)
	{
		return 0;
	}

	var values = {};

	for (var i = 0; i < pairs.length; i++)
	{
		values[pairs[i].tag] = read[pairs[i].ioTag];
	}

	return this.writeAll(call, values);
};

/** Save/Load tag values into the Upload/Download tags. */
HmiRecipeManager.prototype.download = function(call, bookArg)
{
	var book = this.bookArg(call, bookArg, true);

	if (book == null)
	{
		return 0;
	}

	var pairs = book.items.filter(function(it) { return it.tag && it.ioTag; });
	var read = this.readGood(call, pairs.map(function(it) { return it.tag; }));

	if (read == null)
	{
		return 0;
	}

	var values = {};

	for (var i = 0; i < pairs.length; i++)
	{
		values[pairs[i].ioTag] = read[pairs[i].tag];
	}

	return this.writeAll(call, values);
};

HmiRecipeManager.prototype.rename = function(call, bookArg, nameArg, newArg)
{
	var book = this.bookArg(call, bookArg);
	var name = (book != null) ? this.textArg(call, nameArg, 'recipe name') : null;
	var key = (name != null) ? this.recipeKey(call, book, name) : null;
	var next = (key != null) ? this.textArg(call, newArg, 'new recipe name') : null;

	if (next == null)
	{
		return 0;
	}

	var other = HmiRecipes.findKey(book.recipes, next);

	if (other != null && other !== key)
	{
		return this.fail(call, 'A recipe named "' + other + '" already exists in "' + book.name + '".');
	}

	var values = book.recipes[key];
	delete book.recipes[key];
	book.recipes[next] = values;
	HmiRecipes.log('info', 'renamed recipe "' + key + '" to "' + next + '" in "' + book.name + '"');
	this.changed(book);

	return 1;
};

HmiRecipeManager.prototype.deleteRecipe = function(call, bookArg, nameArg, confirm)
{
	var book = this.bookArg(call, bookArg);
	var name = (book != null) ? this.textArg(call, nameArg, 'recipe name') : null;
	var key = (name != null) ? this.recipeKey(call, book, name) : null;

	if (key == null)
	{
		return 0;
	}

	var that = this;
	var remove = function()
	{
		if (book.recipes[key] !== undefined)
		{
			delete book.recipes[key];
			HmiRecipes.log('info', 'deleted recipe "' + key + '" from "' + book.name + '"');
			that.changed(book);
		}
	};

	if (HmiRuntime.truthy(confirm))
	{
		var question = 'Delete the recipe "' + key + '" from "' + book.name + '"?';

		if (this.options.confirm != null)
		{
			this.options.confirm(question, function(yes) { if (yes) { remove(); } });
		}
		else if (this.options.ui != null)
		{
			HmiDialogs.showRecipeConfirm(this.options.ui, 'Delete Recipe', question, 'Delete', function(yes)
			{
				if (yes) { remove(); }
			});
		}

		return 1;
	}

	remove();

	return 1;
};

/** The file side of RecipeExport and RecipeImport. */
HmiRecipeManager.prototype.files = function()
{
	if (this.options.files != null)
	{
		return this.options.files;
	}

	var web = window.electron != null && window.electron.hmiWeb === true;

	return (web || !HmiRecipes.available()) ? HmiRecipes.browserFiles : HmiRecipes.desktopFiles;
};

HmiRecipeManager.prototype.exportRecipe = function(call, bookArg, nameArg)
{
	var book = this.bookArg(call, bookArg);
	var name = (book != null) ? this.textArg(call, nameArg, 'recipe name') : null;
	var key = (name != null) ? this.recipeKey(call, book, name) : null;

	if (key == null)
	{
		return 0;
	}

	var that = this;
	var text = HmiRecipes.toCsv(book.name, key, book.recipes[key], book.items.map(function(it) { return it.tag; }));

	this.files().exportCsv(key, text, function(error, file)
	{
		if (error != null)
		{
			that.report(call, 'The file could not be written: ' + error + '.');
		}
		else if (file != null)
		{
			HmiRecipes.log('info', 'exported recipe "' + key + '" from "' + book.name + '" to ' + file);
		}
	});

	return 1;
};

HmiRecipeManager.prototype.importRecipe = function(call, bookArg, nameArg)
{
	var book = this.bookArg(call, bookArg);
	var name = (book != null) ? this.textArg(call, nameArg, 'recipe name') : null;

	if (name == null)
	{
		return 0;
	}

	var that = this;

	this.files().importCsv(function(error, result)
	{
		if (error != null)
		{
			that.report(call, 'The file could not be read: ' + error + '.');

			return;
		}

		if (result == null)
		{
			return;
		}

		var parsed = HmiRecipes.fromCsv(result.text);
		var values = {};
		var ignored = [];
		var bad = [];

		for (var tag in parsed.values)
		{
			var item = null;

			for (var i = 0; i < book.items.length; i++)
			{
				if (book.items[i].tag && book.items[i].tag.toLowerCase() === tag.toLowerCase())
				{
					item = book.items[i];
				}
			}

			if (item == null)
			{
				ignored.push(tag);
				continue;
			}

			var def = that.project.getTag(item.tag);
			var raw = parsed.values[tag];

			if (def != null && !HmiTypes.isMessage(def.type))
			{
				var n = (HmiTypes.isDiscrete(def.type)) ? HmiSimulator.coerce(def, raw.trim()) : parseFloat(raw);

				if (n == null || isNaN(n))
				{
					bad.push(item.tag);
					continue;
				}

				values[item.tag] = n;
			}
			else
			{
				values[item.tag] = raw;
			}
		}

		if (Object.keys(values).length === 0)
		{
			that.report(call, 'This file is not a recipe for "' + book.name + '": none of its tags are in the book.' +
				((parsed.errors.length > 0) ? '\n' + parsed.errors.slice(0, 5).join('\n') : ''));

			return;
		}

		var key = HmiRecipes.findKey(book.recipes, name);

		if (key != null)
		{
			delete book.recipes[key];
		}

		book.recipes[name] = values;
		HmiRecipes.log('info', 'imported recipe "' + name + '" into "' + book.name + '"');
		that.changed(book);

		var warnings = parsed.errors.slice(0, 5);

		if (bad.length > 0)
		{
			warnings.push('These values are not numbers and were left out: ' + HmiRecipes.listText(bad) + '.');
		}

		if (ignored.length > 0)
		{
			warnings.push('These tags in the file are not in the book and were ignored: ' +
				HmiRecipes.listText(ignored) + '.');
		}

		if (warnings.length > 0)
		{
			that.report(call, 'The recipe was imported, with warnings:\n' + warnings.join('\n'));
		}
	});

	return 1;
};

// ------------------------------------------------------------ file access

/** The desktop apps: the OS dialogs and the files, in the main process. */
HmiRecipes.desktopFiles = {
	exportCsv: function(name, text, fn)
	{
		window.electron.request({action: 'hmiRecipes.exportCsv', defaultName: name, text: text},
			function(file) { fn(null, file); }, function(message) { fn(message); });
	},
	importCsv: function(fn)
	{
		window.electron.request({action: 'hmiRecipes.importCsv'},
			function(result) { fn(null, result); }, function(message) { fn(message); });
	}
};

/** A browser (Append HMI Web): a download, and a file picked in the page. */
HmiRecipes.browserFiles = {
	exportCsv: function(name, text, fn)
	{
		try
		{
			var blob = new Blob([text], {type: 'text/csv'});
			var a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = String(name).replace(/[\x00-\x1f<>:"/\\|?*]/g, '') + '.csv';
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			window.setTimeout(function() { URL.revokeObjectURL(a.href); }, 10000);
			fn(null, a.download);
		}
		catch (e)
		{
			fn(e.message);
		}
	},
	importCsv: function(fn)
	{
		var input = document.createElement('input');
		input.setAttribute('type', 'file');
		input.setAttribute('accept', '.csv,text/csv');
		input.style.display = 'none';
		document.body.appendChild(input);

		mxEvent.addListener(input, 'change', function()
		{
			var file = input.files[0];
			document.body.removeChild(input);

			if (file == null)
			{
				fn(null, null);

				return;
			}

			if (file.size > 1024 * 1024)
			{
				fn('the file is too large');

				return;
			}

			var reader = new FileReader();
			reader.onload = function() { fn(null, {file: file.name, text: String(reader.result)}); };
			reader.onerror = function() { fn('it could not be read'); };
			reader.readAsText(file);
		});

		input.click();
	}
};

// ================================================================= objects

HmiRecipes.isListCell = function(graph, cell)
{
	return cell != null && graph.getModel().isVertex(cell) &&
		graph.getCellStyle(cell)[mxConstants.STYLE_SHAPE] === HmiRecipes.LIST_SHAPE;
};

HmiRecipes.install = function()
{
	function RecipeListShape()
	{
		mxRectangleShape.call(this);
	}

	mxUtils.extend(RecipeListShape, mxRectangleShape);

	RecipeListShape.prototype.paintVertexShape = function(c, x, y, w, h)
	{
		var style = this.style || {};
		var fs = parseFloat(style[mxConstants.STYLE_FONTSIZE]) || 14;
		var rowH = fs * 2;
		var top = y;

		c.setFillColor('#ffffff');
		c.setStrokeColor('#607d8b');
		c.rect(x, y, w, h);
		c.fillAndStroke();
		c.setFontSize(fs);
		c.setFontFamily('Helvetica');

		c.setFillColor('#263238');
		c.rect(x, top, w, rowH);
		c.fill();
		c.setFontColor('#ffffff');
		c.setFontStyle(mxConstants.FONT_BOLD);
		c.text(x + 8, top + rowH / 2, 0, 0, 'Recipes', mxConstants.ALIGN_LEFT, mxConstants.ALIGN_MIDDLE,
			false, '', null, false, 0, null);
		top += rowH;

		c.setFontStyle(0);

		for (var r = 0; top + rowH <= y + h && r < 20; r++)
		{
			c.setFillColor((r === 1) ? '#1a7fc1' : ((r % 2) ? '#f4f6f8' : '#ffffff'));
			c.rect(x + 1, top, w - 2, rowH);
			c.fill();
			c.setFontColor((r === 1) ? '#ffffff' : '#90a4ae');
			c.text(x + 8, top + rowH / 2, 0, 0, 'Recipe ' + (r + 1), mxConstants.ALIGN_LEFT, mxConstants.ALIGN_MIDDLE,
				false, '', null, false, 0, null);
			top += rowH;
		}
	};

	mxCellRenderer.registerShape(HmiRecipes.LIST_SHAPE, RecipeListShape);
};

// ---------------------------------------------------------------- run view

/**
 * The live list of a Recipe List cell in a Run window: an HTML overlay over
 * the cell, following zoom and pan. Its settings are the cell's recipeList
 * link: {book, title, selectedTag, upTag, downTag, arrows}.
 */
HmiRecipeListView = function(runtime, cell, cfg)
{
	this.runtime = runtime;
	this.graph = runtime.graph;
	this.cell = cell;
	this.cfg = cfg || {};
	this.style = this.graph.getCellStyle(cell);
	this.recipes = runtime.recipes;
	this.edges = {};
	this.selected = '';
};

HmiRecipeListView.prototype.start = function()
{
	var that = this;

	this.node = document.createElement('div');
	this.node.className = 'hmiRecipeView';
	this.node.setAttribute('data-hmi-recipe-view', this.cfg.book || '');
	this.graph.container.appendChild(this.node);

	// Pointer presses stay in the list: the window's touch links must not
	// see them
	mxEvent.addListener(this.node, 'pointerdown', function(evt) { evt.stopPropagation(); });
	mxEvent.addListener(this.node, 'mousedown', function(evt) { evt.stopPropagation(); });

	this.onView = function() { that.place(); };
	this.graph.view.addListener(mxEvent.SCALE, this.onView);
	this.graph.view.addListener(mxEvent.TRANSLATE, this.onView);
	this.graph.view.addListener(mxEvent.SCALE_AND_TRANSLATE, this.onView);

	this.onRecipes = function() { that.render(); };

	if (this.recipes != null)
	{
		this.recipes.on('change', this.onRecipes);
	}

	// The up/down tags' present state is not an edge
	this.edges.up = HmiRuntime.truthy(this.value(this.cfg.upTag));
	this.edges.down = HmiRuntime.truthy(this.value(this.cfg.downTag));
	this.selected = this.tagSelection();

	this.place();
	this.render();
};

HmiRecipeListView.prototype.stop = function()
{
	if (this.node == null)
	{
		return;
	}

	this.graph.view.removeListener(this.onView);

	if (this.recipes != null)
	{
		this.recipes.off('change', this.onRecipes);
	}

	if (this.node.parentNode != null)
	{
		this.node.parentNode.removeChild(this.node);
	}

	this.node = null;
};

HmiRecipeListView.prototype.place = function()
{
	var state = this.graph.view.getState(this.cell);

	if (this.node == null || state == null)
	{
		return;
	}

	var s = this.node.style;
	s.left = Math.round(state.x) + 'px';
	s.top = Math.round(state.y) + 'px';
	s.width = Math.round(state.width) + 'px';
	s.height = Math.round(state.height) + 'px';
	s.fontSize = ((parseFloat(this.style[mxConstants.STYLE_FONTSIZE]) || 14) * this.graph.view.scale) + 'px';
};

HmiRecipeListView.prototype.value = function(tag)
{
	return (tag) ? this.runtime.getValue(tag).value : null;
};

HmiRecipeListView.prototype.names = function()
{
	return (this.recipes != null && this.cfg.book) ? this.recipes.recipeNames(this.cfg.book) : [];
};

/** The recipe named by the SelectedRecipe tag, or '' when none matches. */
HmiRecipeListView.prototype.tagSelection = function()
{
	var v = this.value(this.cfg.selectedTag);
	var names = this.names();

	if (v == null || String(v) === '')
	{
		return '';
	}

	for (var i = 0; i < names.length; i++)
	{
		if (names[i].toLowerCase() === String(v).toLowerCase())
		{
			return names[i];
		}
	}

	return '';
};

/** New values (HmiRuntime.applyBatch): the selection tag and up/down edges. */
HmiRecipeListView.prototype.applyBatch = function(batch)
{
	var lower = {};

	for (var name in batch)
	{
		lower[name.toLowerCase()] = batch[name];
	}

	var sel = this.cfg.selectedTag ? lower[this.cfg.selectedTag.toLowerCase()] : null;

	if (sel != null)
	{
		var next = this.tagSelection();

		if (next !== this.selected)
		{
			this.selected = next;
			this.render();
		}
	}

	var dirs = {up: this.cfg.upTag, down: this.cfg.downTag};

	for (var dir in dirs)
	{
		var v = dirs[dir] ? lower[dirs[dir].toLowerCase()] : null;

		if (v != null)
		{
			var on = HmiRuntime.truthy(v.value);

			if (on && !this.edges[dir])
			{
				this.move((dir === 'up') ? -1 : 1);
			}

			this.edges[dir] = on;
		}
	}
};

/** One step up (-1) or down (1); with nothing selected, Down picks the first, Up the last. */
HmiRecipeListView.prototype.move = function(step)
{
	var names = this.names();

	if (names.length === 0)
	{
		return;
	}

	var i = -1;

	for (var j = 0; j < names.length; j++)
	{
		if (names[j] === this.selected)
		{
			i = j;
		}
	}

	var next = (i < 0) ? ((step > 0) ? 0 : names.length - 1) : Math.max(0, Math.min(names.length - 1, i + step));
	this.select(names[next]);
};

HmiRecipeListView.prototype.select = function(name)
{
	this.selected = name;

	if (this.cfg.selectedTag)
	{
		this.runtime.writeField(this.cfg.selectedTag, name);
	}

	this.render();
};

HmiRecipeListView.prototype.render = function()
{
	if (this.node == null)
	{
		return;
	}

	var that = this;
	var names = this.names();

	if (mxUtils.indexOf(names, this.selected) < 0)
	{
		this.selected = this.tagSelection();
	}

	this.node.innerHTML = '';

	var head = document.createElement('div');
	head.className = 'hmiRecipeHead';
	var title = document.createElement('span');
	title.className = 'hmiRecipeTitle';
	mxUtils.write(title, (this.cfg.title != null && this.cfg.title !== '') ? this.cfg.title : (this.cfg.book || 'Recipes'));
	head.appendChild(title);

	if (this.cfg.arrows === true || this.cfg.arrows === 'true')
	{
		[['up', '▲', -1], ['down', '▼', 1]].forEach(function(a)
		{
			var btn = document.createElement('button');
			btn.setAttribute('data-hmi-recipe-move', a[0]);
			btn.setAttribute('title', (a[0] === 'up') ? 'Previous recipe' : 'Next recipe');
			mxUtils.write(btn, a[1]);
			mxEvent.addListener(btn, 'click', function(evt)
			{
				mxEvent.consume(evt);
				that.move(a[2]);
			});
			head.appendChild(btn);
		});
	}

	this.node.appendChild(head);

	var list = document.createElement('div');
	list.className = 'hmiRecipeRows';

	if (names.length === 0)
	{
		var empty = document.createElement('div');
		empty.className = 'hmiRecipeEmpty';
		mxUtils.write(empty, (this.cfg.book) ? 'No recipes.' : 'No recipe book chosen.');
		list.appendChild(empty);
	}

	for (var i = 0; i < names.length; i++)
	{
		(function(name)
		{
			var row = document.createElement('div');
			row.className = 'hmiRecipeRow' + ((name === that.selected) ? ' hmiRecipeSelected' : '');
			row.setAttribute('data-hmi-recipe', name);
			mxUtils.write(row, name);
			mxEvent.addListener(row, 'click', function(evt)
			{
				mxEvent.consume(evt);
				that.select(name);
			});
			list.appendChild(row);
		})(names[i]);
	}

	this.node.appendChild(list);

	var sel = list.querySelector('.hmiRecipeSelected');

	if (sel != null && sel.scrollIntoView != null)
	{
		sel.scrollIntoView({block: 'nearest'});
	}
};
