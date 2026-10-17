/**
 * SQL database access: the project's own part of it.
 *
 * Four things are configured in the project and used by the SQL* script
 * functions:
 *
 * - data sources, the databases the application can open. A data source holds
 *   everything but the password, and may hold that too (wrapped, which is
 *   obfuscation and no more -- see src/main/sql/Secret.js). The PC that runs
 *   the application can override the credentials instead, so a site can keep
 *   the password off the project file;
 * - bind lists, which pair a tag with a database column. A select writes the
 *   columns into the tags; an insert or an update reads the tags into the
 *   columns;
 * - table templates, the shape of a table the application creates for itself;
 * - queries, SQL statements kept by name in the project rather than in files
 *   beside the installer.
 *
 * Nothing here talks to a database. The statements go to the main process
 * (src/main/sql/), which is the only place that does.
 */
HmiSql = function() {};

/** Kinds of database. */
HmiSql.PROVIDERS = [
	{value: 'mssql', label: 'Microsoft SQL Server'},
	{value: 'sqlite', label: 'SQLite file'}
];

/** The provider entry for a value, or null. Case-insensitive. */
HmiSql.provider = function(value)
{
	var want = ('' + (value == null ? '' : value)).toLowerCase();

	for (var i = 0; i < HmiSql.PROVIDERS.length; i++)
	{
		if (HmiSql.PROVIDERS[i].value === want)
		{
			return HmiSql.PROVIDERS[i];
		}
	}

	return null;
};

/**
 * Which folder a SQLite file lives in. The project holds a name, never a
 * path: an absolute path would name one machine's account, and a published
 * application runs on another PC, often as another user.
 */
HmiSql.FOLDERS = [
	{value: 'appdata', label: 'Application data folder'},
	{value: 'documents', label: 'Documents'}
];

HmiSql.normalizeFolder = function(value)
{
	return (('' + (value == null ? '' : value)).toLowerCase() === 'documents') ? 'documents' : 'appdata';
};

HmiSql.DEFAULT_PORT = 1433;
HmiSql.DEFAULT_TIMEOUT_MS = 15000;
HmiSql.DEFAULT_MAX_ROWS = 10000;

/** How long a name may be, in any of the four lists. */
HmiSql.MAX_NAME = 64;

/** How long a column name may be. */
HmiSql.MAX_COLUMN = 128;

/**
 * Column types a table template may declare. They are ours, not any one
 * database's, and the statement that creates a table maps them to whatever
 * the data source wants.
 */
HmiSql.COLUMN_TYPES = [
	{value: 'text', label: 'Text', length: true},
	{value: 'integer', label: 'Whole number'},
	{value: 'number', label: 'Number'},
	{value: 'decimal', label: 'Decimal', length: true, scale: true},
	{value: 'boolean', label: 'On or off'},
	{value: 'date', label: 'Date'},
	{value: 'time', label: 'Time'},
	{value: 'datetime', label: 'Date and time'}
];

HmiSql.columnType = function(value)
{
	var want = ('' + (value == null ? '' : value)).toLowerCase();

	for (var i = 0; i < HmiSql.COLUMN_TYPES.length; i++)
	{
		if (HmiSql.COLUMN_TYPES[i].value === want)
		{
			return HmiSql.COLUMN_TYPES[i];
		}
	}

	return null;
};

HmiSql.normalizeType = function(value)
{
	var found = HmiSql.columnType(value);

	return (found != null) ? found.value : 'text';
};

/** Whether a column is indexed, and whether the index allows repeats. */
HmiSql.INDEX_KINDS = [
	{value: 'none', label: 'No index'},
	{value: 'nonunique', label: 'Index, repeats allowed'},
	{value: 'unique', label: 'Index, each value unique'}
];

HmiSql.normalizeIndex = function(value)
{
	var want = ('' + (value == null ? '' : value)).toLowerCase();

	for (var i = 0; i < HmiSql.INDEX_KINDS.length; i++)
	{
		if (HmiSql.INDEX_KINDS[i].value === want)
		{
			return want;
		}
	}

	return 'none';
};

/**
 * Words a column may not be named, because one of the two databases this
 * application supports reserves it: the union of SQL Server's reserved
 * keywords and SQLite's.
 *
 * It is deliberately not the wider SQL-92 or ODBC list. That one reserves
 * LEVEL, DATE and TIME, which neither of our databases refuses and which an
 * HMI names a column after constantly -- a warning that fires on "Level" is a
 * warning nobody reads. A third kind of database would widen this list.
 */
HmiSql.RESERVED_COLUMNS = ('abort action add after all alter always analyze and any as asc attach authorization ' +
	'autoincrement backup before begin between break browse bulk by cascade case cast check ' +
	'checkpoint close clustered coalesce collate column commit compute conflict constraint contains ' +
	'containstable continue convert create cross current current_date current_time current_timestamp ' +
	'current_user cursor database dbcc deallocate declare default deferrable deferred delete deny ' +
	'desc detach disk distinct distributed do double drop dump each else end errlvl escape except ' +
	'exclude exclusive exec execute exists exit explain external fail fetch file fillfactor filter ' +
	'first following for foreign freetext freetexttable from full function generated glob goto grant ' +
	'group groups having holdlock identity identity_insert identitycol if ignore immediate in index ' +
	'indexed initially inner insert instead intersect into is isnull join key kill last left like ' +
	'limit lineno load match materialized merge national natural no nocheck nonclustered not nothing ' +
	'notnull null nullif nulls of off offsets on open opendatasource openquery openrowset openxml ' +
	'option or order others outer over partition percent pivot plan pragma preceding precision ' +
	'primary print proc procedure public query raise raiserror range read readtext reconfigure ' +
	'recursive references regexp reindex release rename replace replication restore restrict return ' +
	'returning revert revoke right rollback row rowcount rowguidcol rows rule save savepoint schema ' +
	'securityaudit select session_user set setuser shutdown some statistics system_user table ' +
	'tablesample temp temporary textsize then ties to top tran transaction trigger truncate tsequal ' +
	'unbounded union unique unpivot update updatetext use user using vacuum values varying view ' +
	'virtual waitfor when where while window with without writetext').split(' ');

HmiSql.isReservedColumn = function(name)
{
	return mxUtils.indexOf(HmiSql.RESERVED_COLUMNS, ('' + (name == null ? '' : name)).toLowerCase()) >= 0;
};

/**
 * A column name a database needs brackets around, because it has a space or
 * punctuation in it. Scripts have to bracket it too, so the dialog says so
 * rather than silently letting a statement fail.
 */
HmiSql.needsBrackets = function(name)
{
	return !/^[A-Za-z_][A-Za-z0-9_]*$/.test('' + (name == null ? '' : name));
};

/**
 * The column type that suits a tag, for building a table template out of a
 * bind list. A dotfield reads a flag rather than the tag's own value.
 */
HmiSql.typeForTag = function(project, name, field)
{
	if (field === 'InAlarm' || field === 'Acked')
	{
		return 'boolean';
	}

	var tag = (project != null) ? project.getTag(name) : null;

	if (tag == null)
	{
		return 'text';
	}

	if (HmiTypes.isDiscrete(tag.type))
	{
		return 'boolean';
	}

	if (HmiTypes.isMessage(tag.type))
	{
		return 'text';
	}

	return HmiTypes.isInteger(tag.type) ? 'integer' : 'number';
};

// ----------------------------------------------------------------- new items

HmiSql.newDataSource = function(name)
{
	return {name: name || '', provider: 'mssql', host: '', port: '', database: '',
		file: '', folder: 'appdata', user: '', password: '', timeoutMs: '',
		options: {encrypt: false, trustServerCertificate: true, legacyTls: false, instanceName: ''}};
};

HmiSql.newBindList = function(name)
{
	return {name: name || '', items: []};
};

HmiSql.newBindItem = function()
{
	return {tag: '', field: '', column: '', delim: ''};
};

HmiSql.newTemplate = function(name)
{
	return {name: name || '', columns: []};
};

HmiSql.newColumn = function()
{
	return {name: '', type: 'text', length: '', scale: '', index: 'none', allowNull: true};
};

HmiSql.newQuery = function(name)
{
	return {name: name || '', sql: ''};
};

// --------------------------------------------------------------- finding one

/** Looks a name up in one of the project's lists. Case-insensitive. */
HmiSql.find = function(list, name)
{
	var want = ('' + (name == null ? '' : name)).toLowerCase();

	for (var i = 0; list != null && i < list.length; i++)
	{
		if (('' + list[i].name).toLowerCase() === want)
		{
			return list[i];
		}
	}

	return null;
};

HmiSql.dataSource = function(project, name)
{
	return (project != null) ? HmiSql.find(project.dataSources, name) : null;
};

HmiSql.bindList = function(project, name)
{
	return (project != null) ? HmiSql.find(project.bindLists, name) : null;
};

HmiSql.tableTemplate = function(project, name)
{
	return (project != null) ? HmiSql.find(project.tableTemplates, name) : null;
};

HmiSql.query = function(project, name)
{
	return (project != null) ? HmiSql.find(project.queries, name) : null;
};

// ------------------------------------------------------------------ the rules

/**
 * What is wrong with a name, or null. Shared by the dialog, the command line
 * and Validate, so all three say the same thing.
 *
 * @param list  the list it belongs to, for the duplicate check; the item
 *              itself is skipped, so an unchanged name is not its own clash
 * @param what  'A data source', 'A bind list', ...
 */
HmiSql.nameProblem = function(list, item, what)
{
	var name = '' + (item.name == null ? '' : item.name);

	if (name.trim() === '')
	{
		return what + ' needs a name.';
	}

	if (name.length > HmiSql.MAX_NAME)
	{
		return what + ' name can be at most ' + HmiSql.MAX_NAME + ' characters.';
	}

	if (/[\x00-\x1f"']/.test(name))
	{
		return what + ' name cannot contain quotation marks or control characters.';
	}

	for (var i = 0; list != null && i < list.length; i++)
	{
		if (list[i] !== item && ('' + list[i].name).toLowerCase() === name.toLowerCase())
		{
			return 'There are two of these named "' + name + '".';
		}
	}

	return null;
};

/** What is wrong with a data source, or null. */
HmiSql.dataSourceProblem = function(list, source)
{
	var problem = HmiSql.nameProblem(list, source, 'A data source');

	if (problem != null)
	{
		return problem;
	}

	if (HmiSql.provider(source.provider) == null)
	{
		return '"' + source.provider + '" is not a kind of database this application supports.';
	}

	if (source.provider === 'sqlite')
	{
		if (('' + (source.file || '')).trim() === '')
		{
			return 'A SQLite data source needs a file name.';
		}

		// A name inside the chosen folder, never a path: the main process
		// refuses the rest, and an absolute path would not survive being
		// published to another PC
		if (/^[\\/]|^[A-Za-z]:|(^|[\\/])\.\.([\\/]|$)/.test('' + source.file))
		{
			return 'A database file is named relative to the folder it is kept in, so its ' +
				'name cannot be an absolute path or contain "..".';
		}

		return null;
	}

	if (('' + (source.host || '')).trim() === '')
	{
		return 'A SQL Server data source needs a server.';
	}

	if (source.port !== '' && source.port != null)
	{
		var port = parseInt(source.port, 10);

		if (isNaN(port) || port < 1 || port > 65535)
		{
			return 'The port must be a number from 1 to 65535.';
		}
	}

	if (source.timeoutMs !== '' && source.timeoutMs != null)
	{
		var ms = parseInt(source.timeoutMs, 10);

		if (isNaN(ms) || ms < 100 || ms > 600000)
		{
			return 'The timeout must be from 100 to 600000 milliseconds.';
		}
	}

	return null;
};

/**
 * What is wrong with a bind list, or null. Tag names are Validate's business.
 *
 * @param draft  true while the dialog is editing one, so that a list the user
 *               has just created and not yet filled in can still be saved. A
 *               project is checked without it, so an empty list is a problem
 *               Validate and the command line both report.
 */
HmiSql.bindListProblem = function(list, bindList, draft)
{
	var problem = HmiSql.nameProblem(list, bindList, 'A bind list');

	if (problem != null)
	{
		return problem;
	}

	var items = bindList.items || [];

	if (items.length === 0 && !draft)
	{
		return 'Bind list "' + bindList.name + '" has no tags in it.';
	}

	var seen = {};

	for (var i = 0; i < items.length; i++)
	{
		var column = '' + (items[i].column == null ? '' : items[i].column);

		if (column.trim() === '')
		{
			return 'Every row of a bind list needs a column name.';
		}

		if (column.length > HmiSql.MAX_COLUMN)
		{
			return 'A column name can be at most ' + HmiSql.MAX_COLUMN + ' characters.';
		}

		if (seen[column.toLowerCase()])
		{
			return 'Bind list "' + bindList.name + '" uses the column "' + column + '" twice.';
		}

		seen[column.toLowerCase()] = true;

		if (('' + (items[i].tag == null ? '' : items[i].tag)).trim() === '')
		{
			return 'Every row of a bind list needs a tag.';
		}
	}

	return null;
};

/** What is wrong with a table template, or null. draft as for a bind list. */
HmiSql.templateProblem = function(list, template, draft)
{
	var problem = HmiSql.nameProblem(list, template, 'A table template');

	if (problem != null)
	{
		return problem;
	}

	var columns = template.columns || [];

	if (columns.length === 0 && !draft)
	{
		return 'Table template "' + template.name + '" has no columns.';
	}

	var seen = {};

	for (var i = 0; i < columns.length; i++)
	{
		var c = columns[i];
		var name = '' + (c.name == null ? '' : c.name);

		if (name.trim() === '')
		{
			return 'Every column of a table template needs a name.';
		}

		if (name.length > HmiSql.MAX_COLUMN)
		{
			return 'A column name can be at most ' + HmiSql.MAX_COLUMN + ' characters.';
		}

		if (seen[name.toLowerCase()])
		{
			return 'Table template "' + template.name + '" has two columns named "' + name + '".';
		}

		seen[name.toLowerCase()] = true;

		if (HmiSql.columnType(c.type) == null)
		{
			return 'Column "' + name + '" has no type.';
		}

		var type = HmiSql.columnType(c.type);

		if (type.length && c.length !== '' && c.length != null)
		{
			var len = parseInt(c.length, 10);

			if (isNaN(len) || len < 1 || len > 1000000)
			{
				return 'The length of column "' + name + '" must be a number of characters.';
			}
		}

		if (type.scale && c.scale !== '' && c.scale != null)
		{
			var scale = parseInt(c.scale, 10);

			if (isNaN(scale) || scale < 0 || scale > 38)
			{
				return 'The scale of column "' + name + '" must be from 0 to 38.';
			}
		}
	}

	return null;
};

/**
 * What is wrong with a query, or null. The SQL itself is the database's
 * business. draft as for a bind list.
 */
HmiSql.queryProblem = function(list, query, draft)
{
	var problem = HmiSql.nameProblem(list, query, 'A query');

	if (problem != null)
	{
		return problem;
	}

	if (('' + (query.sql == null ? '' : query.sql)).trim() === '' && !draft)
	{
		return 'Query "' + query.name + '" has no statement.';
	}

	return null;
};

// ------------------------------------------------------------- main process

HmiSql.available = function()
{
	return window.electron != null && typeof window.electron.request === 'function';
};

HmiSql.request = function(action, args, fn, error)
{
	if (!HmiSql.available())
	{
		if (error != null)
		{
			error(new Error('Databases are not available in this build.'));
		}

		return;
	}

	var msg = args || {};
	msg.action = action;
	window.electron.request(msg, fn, error);
};

/** A deep copy of one of the project's lists, for a dialog to edit. */
HmiSql.copyList = function(list)
{
	return (list != null) ? JSON.parse(JSON.stringify(list)) : [];
};

/**
 * Wraps a password for storing in the project. The algorithm lives in the
 * main process, so there is one of it.
 */
HmiSql.wrapPassword = function(password, fn, error)
{
	if (password == null || password === '')
	{
		fn('');

		return;
	}

	HmiSql.request('hmiSql.wrapSecret', {password: '' + password}, function(res)
	{
		fn((res != null && res.password != null) ? res.password : '');
	}, error);
};

/** Tries a data source: the dialog's Test button. */
HmiSql.probe = function(source, fn, error)
{
	HmiSql.request('hmiSql.probe', {dataSource: HmiSql.toSpec(source)}, fn, error);
};

/**
 * A data source as the main process wants it: the empty strings that mean
 * "use the default" are left out, and a number is a number.
 */
HmiSql.toSpec = function(source)
{
	var spec = {name: source.name, provider: HmiSql.provider(source.provider) != null ?
		('' + source.provider).toLowerCase() : 'mssql'};

	if (spec.provider === 'sqlite')
	{
		spec.file = source.file || '';
		spec.folder = HmiSql.normalizeFolder(source.folder);
	}
	else
	{
		spec.host = source.host || '';
		spec.database = source.database || '';
		spec.user = source.user || '';
		spec.password = source.password || '';

		if (source.port !== '' && source.port != null)
		{
			spec.port = parseInt(source.port, 10);
		}

		var o = source.options || {};
		spec.options = {encrypt: o.encrypt === true,
			trustServerCertificate: o.trustServerCertificate !== false,
			legacyTls: o.legacyTls === true};

		if (o.instanceName)
		{
			spec.options.instanceName = o.instanceName;
		}
	}

	if (source.timeoutMs !== '' && source.timeoutMs != null)
	{
		spec.timeoutMs = parseInt(source.timeoutMs, 10);
	}

	return spec;
};

/** Whether any password is still in plain text and needs wrapping. */
HmiSql.needsWrapping = function(sources)
{
	for (var i = 0; sources != null && i < sources.length; i++)
	{
		if (sources[i].password && !HmiSql.isWrapped(sources[i].password))
		{
			return true;
		}
	}

	return false;
};

/**
 * Wraps every data source password that is still in plain text: what the
 * dialog took from the user, or what a command-line spec gave. One that is
 * already wrapped -- loaded from a project, or from a dump -- is left alone,
 * so wrapping twice cannot happen and a dump rebuilds identically.
 */
HmiSql.wrapPasswords = function(sources)
{
	var pending = [];

	for (var i = 0; sources != null && i < sources.length; i++)
	{
		var source = sources[i];

		if (!source.password || HmiSql.isWrapped(source.password))
		{
			continue;
		}

		pending.push(function(s)
		{
			return new Promise(function(resolve, reject)
			{
				HmiSql.wrapPassword(s.password, function(wrapped)
				{
					s.password = wrapped;
					resolve();
				}, reject);
			});
		}(source));
	}

	return Promise.all(pending);
};

/** Whether a password has already been wrapped (src/main/sql/Secret.js). */
HmiSql.isWrapped = function(value)
{
	return typeof value === 'string' && value.indexOf('hmi1:') === 0;
};

/** What this computer holds for the project's data sources, if anything. */
HmiSql.overrides = function(store, fn, error)
{
	if (!store || !HmiSql.available())
	{
		fn([]);

		return;
	}

	HmiSql.request('hmiSql.overrides', {store: store}, function(list)
	{
		fn(Array.isArray(list) ? list : []);
	}, error);
};

/**
 * Sets or removes this computer's own credentials for one data source. A
 * window may set one and may ask whether one is set, but never reads one back.
 */
HmiSql.setOverride = function(store, name, override, fn, error)
{
	HmiSql.request('hmiSql.setOverride', {store: store, name: name, override: override},
		function(list)
		{
			fn(Array.isArray(list) ? list : []);
		}, error);
};

// ============================================================ result codes

/**
 * What a SQL function hands back, and what SQLErrorMsg says about it.
 *
 * The numbers are an interface: scripts test them, so they are fixed. They are
 * the same numbers src/main/sql/ResultCodes.js uses -- a test keeps the two
 * tables in step, because the renderer cannot import from the main process.
 *
 * -1007 is absent on purpose. It warned that a column had been truncated on
 * its way into a message tag, and our message tags have no length limit.
 */
HmiSql.CODES = {
	OK: 0,
	PROVIDER_ERROR: -1,
	EMPTY_STATEMENT: -2,
	NULL_VALUE: -4,
	NO_MORE_ROWS: -5,
	INVALID_PARAM_ID: -7,
	INVALID_PARAM_LIST: -8,
	INVALID_NULL_TYPE: -9,
	PARAM_TYPE_CHANGED: -10,
	PARAM_AFTER_EXECUTE: -11,
	INVALID_DATETIME: -12,
	INVALID_DECIMAL: -13,
	INVALID_CURRENCY: -14,
	INVALID_STATEMENT_TYPE: -15,
	OUT_OF_MEMORY: -1001,
	INVALID_CONNECTION: -1002,
	NO_BIND_LIST: -1003,
	NO_TEMPLATE: -1004,
	INTERNAL: -1005,
	STRING_NULL: -1006,
	NO_WHERE_CLAUSE: -1008,
	CONNECT_FAILED: -1009,
	NO_DATABASE: -1010,
	NO_ROWS_SELECTED: -1011,
	NO_FILE: -1013,
	NO_DATA_SOURCE: -1100,
	TIMED_OUT: -1101,
	TOO_MANY_ROWS: -1102,
	TOO_MANY_CONNECTIONS: -1103,
	PROVIDER_UNAVAILABLE: -1104,
	NO_QUERY: -1105,
	TRANSACTION_STATE: -1106,
	FILE_NOT_ALLOWED: -1107
};

HmiSql.MESSAGES = {
	0: 'No errors occurred',
	'-1': 'The database reported an error',
	'-2': 'There is no statement to execute',
	'-4': 'The value read was null',
	'-5': 'There are no more rows to fetch',
	'-7': 'That parameter number is not valid',
	'-8': 'The statement has a gap in its parameter numbers',
	'-9': 'That type cannot be used for a null parameter',
	'-10': "A parameter's type cannot be changed once it is set",
	'-11': 'A parameter cannot be added after the statement has run',
	'-12': 'That is not a valid date or time',
	'-13': 'That is not a valid decimal number',
	'-14': 'That is not a valid currency amount',
	'-15': 'That operation does not suit this kind of statement',
	'-1001': 'There is not enough memory to complete this operation',
	'-1002': 'That connection number is not open',
	'-1003': 'There is no bind list of that name',
	'-1004': 'There is no table template of that name',
	'-1005': 'An internal error occurred',
	'-1006': 'The string read was null',
	'-1008': 'Deleting records needs a where expression',
	'-1009': 'The database could not be reached',
	'-1010': 'That database does not exist',
	'-1011': 'No rows have been selected',
	'-1013': 'The file could not be found',
	'-1100': 'There is no data source of that name',
	'-1101': 'The database did not answer in time',
	'-1102': 'The query returned more rows than the limit allows',
	'-1103': 'Too many database connections are open',
	'-1104': 'That kind of database is not supported',
	'-1105': 'There is no query of that name',
	'-1106': 'That does not suit the current transaction',
	'-1107': 'A database file must be in Documents or the application data folder'
};

/**
 * Codes that are not failures: a script meets them in the ordinary course of
 * things, so they go to the runtime log and not to the Database Error window.
 *
 * Running off the end of a selection is how a loop over the rows finishes
 * (WHILE SQLNext(ConnId) == 0), and a null column is something a database
 * holds legitimately -- the tag gets 0 or no text. Showing an operator a
 * window for either would make the feature unusable.
 */
HmiSql.WARNINGS = [HmiSql.CODES.NO_MORE_ROWS, HmiSql.CODES.NULL_VALUE, HmiSql.CODES.STRING_NULL];

HmiSql.isWarning = function(code)
{
	return mxUtils.indexOf(HmiSql.WARNINGS, Number(code)) >= 0;
};

/** The message for a code. A code we do not know still reads sensibly. */
HmiSql.message = function(code)
{
	var n = Number(code);

	if (!isFinite(n))
	{
		return HmiSql.MESSAGES[HmiSql.CODES.INTERNAL];
	}

	var found = HmiSql.MESSAGES['' + n];

	return (found != null) ? found : 'Result code ' + n;
};

// ============================================================== the functions

/** Every SQL* script function this release provides. */
HmiSql.FUNCTIONS = ['SQLConnect', 'SQLDisconnect', 'SQLSelect', 'SQLFirst', 'SQLNext',
	'SQLPrev', 'SQLLast', 'SQLGetRecord', 'SQLNumRows', 'SQLEnd', 'SQLErrorMsg'];

/** The ones that reach a database and so pause the script. */
HmiSql.ASYNC_FUNCTIONS = ['SQLConnect', 'SQLDisconnect', 'SQLSelect'];

HmiSql.isFunction = function(name)
{
	return mxUtils.indexOf(HmiSql.FUNCTIONS, name) >= 0;
};

HmiSql.isAsyncFunction = function(name)
{
	return mxUtils.indexOf(HmiSql.ASYNC_FUNCTIONS, name) >= 0;
};

/** How a call reads in an error message. */
HmiSql.describeCall = function(name, args)
{
	return name + '(' + (args || []).map(function(a)
	{
		return (typeof a === 'string') ? '"' + a + '"' : String(a);
	}).join(', ') + ')';
};

/**
 * A connect string, for a script that gives one instead of naming a data
 * source in the project. Only what is needed to reach the two kinds of
 * database we support is understood; anything else in it is ignored.
 */
HmiSql.parseConnectString = function(text)
{
	var parts = ('' + text).split(';');
	var found = {};

	for (var i = 0; i < parts.length; i++)
	{
		var at = parts[i].indexOf('=');

		if (at > 0)
		{
			found[parts[i].substring(0, at).trim().toLowerCase().replace(/\s+/g, ' ')] =
				parts[i].substring(at + 1).trim();
		}
	}

	var pick = function()
	{
		for (var a = 0; a < arguments.length; a++)
		{
			if (found[arguments[a]] != null && found[arguments[a]] !== '')
			{
				return found[arguments[a]];
			}
		}

		return '';
	};

	var spec = HmiSql.newDataSource('');
	var file = pick('file', 'database file');

	if (file !== '')
	{
		spec.provider = 'sqlite';
		spec.file = file;

		return spec;
	}

	spec.provider = 'mssql';
	spec.host = pick('data source', 'server', 'address', 'addr');
	spec.database = pick('initial catalog', 'database', 'db');
	spec.user = pick('user id', 'uid', 'user', 'username');
	spec.password = pick('password', 'pwd');

	return spec;
};

// ================================================================= manager

/**
 * The database side of one Run, shared by every window as the connections
 * themselves are: a connection opened by one window's script is the same
 * connection another window's script addresses by its number.
 *
 * The results of a selection are held here, so moving through them costs
 * nothing: SQLFirst and the rest are ordinary synchronous actions, and only
 * the calls that reach a database pause the script.
 *
 * @param project  the HmiProject
 * @param driver   a hub client: writes the tags a selection fetches into
 * @param options  {ui, store (the per-PC credentials), report(call, message)
 *                 (default: the Database Error window), request(action, args,
 *                 fn, error) (default: the main process)}
 */
HmiSqlManager = function(project, driver, options)
{
	this.project = project;
	this.driver = driver;
	this.options = options || {};
	this.connections = {};
	this.running = false;

	// SQLErrorMsg(-1) gives the database's own words for the last failure
	this.lastProviderMessage = '';
};

HmiSqlManager.prototype.start = function()
{
	this.running = true;
};

/** Closes every connection as the Run ends. */
HmiSqlManager.prototype.stop = function()
{
	this.running = false;

	for (var id in this.connections)
	{
		this.request('hmiSql.close', {connectionId: Number(id)}, function() {}, function() {});
	}

	this.connections = {};
};

HmiSqlManager.prototype.request = function(action, args, fn, error)
{
	if (this.options.request != null)
	{
		this.options.request(action, args, fn, error);

		return;
	}

	HmiSql.request(action, args, fn, error);
};

HmiSqlManager.prototype.report = function(call, message)
{
	HmiLog.warn('sql: ' + (call ? call + ': ' : '') + message);

	if (this.options.report != null)
	{
		this.options.report(call, message);
	}
	else if (this.options.ui != null)
	{
		HmiDialogs.queueFunctionError(this.options.ui, call, message);
	}
};

/**
 * A failure: the code a script sees, with the reason shown in the Database
 * Error window. A code alone would leave an operator with nothing.
 */
HmiSqlManager.prototype.fail = function(call, code, message)
{
	var text = (message != null && message !== '') ? message : HmiSql.message(code);

	if (code === HmiSql.CODES.PROVIDER_ERROR)
	{
		this.lastProviderMessage = text;
	}

	// A loop over a selection ends by running off the end of it, so that code
	// belongs in the log and not in front of an operator
	if (HmiSql.isWarning(code))
	{
		HmiLog.warn('sql: ' + (call ? call + ': ' : '') + text);
	}
	else
	{
		this.report(call, text);
	}

	return code;
};

HmiSqlManager.prototype.connectionOf = function(id)
{
	var n = Number(id);

	return (isFinite(n) && this.connections[n] != null) ? this.connections[n] : null;
};

// ------------------------------------------------------------- the calls

/** The synchronous functions: everything that does not reach a database. */
HmiSqlManager.prototype.call = function(name, args)
{
	var call = HmiSql.describeCall(name, args);

	switch (name)
	{
		case 'SQLErrorMsg':
			return this.errorMessage(args[0]);
		case 'SQLNumRows':
			return this.numRows(call, args[0]);
		case 'SQLFirst':
			return this.move(call, args[0], 'first');
		case 'SQLNext':
			return this.move(call, args[0], 'next');
		case 'SQLPrev':
			return this.move(call, args[0], 'prev');
		case 'SQLLast':
			return this.move(call, args[0], 'last');
		case 'SQLGetRecord':
			return this.getRecord(call, args[0], args[1]);
		case 'SQLEnd':
			return this.end(call, args[0]);
	}

	return null;
};

/** The asynchronous ones: the script waits for the database. */
HmiSqlManager.prototype.callAsync = function(name, args, done)
{
	var call = HmiSql.describeCall(name, args);

	if (!this.running)
	{
		done(HmiSql.CODES.INVALID_CONNECTION);

		return;
	}

	switch (name)
	{
		case 'SQLConnect':
			this.connect(call, args[0], args[1], done);

			return;
		case 'SQLDisconnect':
			this.disconnect(call, args[0], done);

			return;
		case 'SQLSelect':
			this.select(call, args, done);

			return;
	}

	done(HmiSql.CODES.INTERNAL);
};

/** SQLErrorMsg: the words for a code, the database's own for -1. */
HmiSqlManager.prototype.errorMessage = function(code)
{
	if (Number(code) === HmiSql.CODES.PROVIDER_ERROR && this.lastProviderMessage !== '')
	{
		return this.lastProviderMessage;
	}

	return HmiSql.message(code);
};

/**
 * SQLConnect(ConnectionID, "DataSource or connect string"): opens a
 * connection and writes its number to the named tag.
 */
HmiSqlManager.prototype.connect = function(call, tagName, which, done)
{
	var that = this;
	var name = '' + (which == null ? '' : which);
	var source = HmiSql.dataSource(this.project, name);

	if (source == null)
	{
		// A script may give a connect string instead of naming a data source
		if (name.indexOf('=') > 0)
		{
			source = HmiSql.parseConnectString(name);
			source.name = name;
		}
		else
		{
			done(this.fail(call, HmiSql.CODES.NO_DATA_SOURCE,
				'There is no data source named "' + name + '".'));

			return;
		}
	}

	this.request('hmiSql.connect', {dataSource: HmiSql.toSpec(source), store: this.options.store || ''},
		function(res)
		{
			if (res == null || res.code !== HmiSql.CODES.OK)
			{
				done(that.fail(call, (res != null) ? res.code : HmiSql.CODES.INTERNAL,
					(res != null) ? res.message : null));

				return;
			}

			that.connections[res.connectionId] = {id: res.connectionId, source: source.name,
				provider: res.provider, results: null, cursor: -1, bindList: ''};
			that.writeTag(tagName, res.connectionId);
			done(HmiSql.CODES.OK);
		},
		function(e)
		{
			done(that.fail(call, HmiSql.CODES.CONNECT_FAILED, e.message));
		});
};

HmiSqlManager.prototype.disconnect = function(call, id, done)
{
	var that = this;
	var connection = this.connectionOf(id);

	if (connection == null)
	{
		done(this.fail(call, HmiSql.CODES.INVALID_CONNECTION));

		return;
	}

	delete this.connections[connection.id];

	this.request('hmiSql.close', {connectionId: connection.id}, function()
	{
		done(HmiSql.CODES.OK);
	},
	function(e)
	{
		done(that.fail(call, HmiSql.CODES.PROVIDER_ERROR, e.message));
	});
};

/**
 * SQLSelect(ConnectionID, TableName, BindList, WhereExpr, OrderByExpr): the
 * rows are held here, to be walked with SQLFirst and the rest.
 */
HmiSqlManager.prototype.select = function(call, args, done)
{
	var that = this;
	var connection = this.connectionOf(args[0]);

	if (connection == null)
	{
		done(this.fail(call, HmiSql.CODES.INVALID_CONNECTION));

		return;
	}

	var table = ('' + (args[1] == null ? '' : args[1])).trim();
	var bindName = '' + (args[2] == null ? '' : args[2]);
	var where = ('' + (args[3] == null ? '' : args[3])).trim();
	var order = ('' + (args[4] == null ? '' : args[4])).trim();

	if (table === '')
	{
		done(this.fail(call, HmiSql.CODES.EMPTY_STATEMENT, 'SQLSelect needs the name of a table.'));

		return;
	}

	var bindList = HmiSql.bindList(this.project, bindName);

	if (bindList == null)
	{
		done(this.fail(call, HmiSql.CODES.NO_BIND_LIST,
			'There is no bind list named "' + bindName + '".'));

		return;
	}

	var columns = bindList.items.map(function(item) { return HmiSql.quoteColumn(item.column); });
	var sql = 'SELECT ' + columns.join(', ') + ' FROM ' + HmiSql.quoteColumn(table);

	if (where !== '')
	{
		sql += ' WHERE ' + where;
	}

	if (order !== '')
	{
		sql += ' ORDER BY ' + order;
	}

	this.request('hmiSql.exec', {connectionId: connection.id, sql: sql,
		maxRows: HmiSql.maxRows()}, function(res)
		{
			if (res == null || res.code !== HmiSql.CODES.OK)
			{
				done(that.fail(call, (res != null) ? res.code : HmiSql.CODES.INTERNAL,
					(res != null) ? res.message : null));

				return;
			}

			connection.results = {columns: res.columns || [], rows: res.rows || []};
			connection.cursor = -1;
			connection.bindList = bindList.name;

			if (res.truncated)
			{
				// Not a failure: the rows that came back are usable, and a
				// script that never looks at the code still works
				that.report(call, HmiSql.message(HmiSql.CODES.TOO_MANY_ROWS) + ' (' +
					connection.results.rows.length + ' kept).');
			}

			done(HmiSql.CODES.OK);
		},
		function(e)
		{
			done(that.fail(call, HmiSql.CODES.PROVIDER_ERROR, e.message));
		});
};

/** SQLNumRows: how many rows the last selection found. */
HmiSqlManager.prototype.numRows = function(call, id)
{
	var connection = this.connectionOf(id);

	if (connection == null)
	{
		return this.fail(call, HmiSql.CODES.INVALID_CONNECTION);
	}

	if (connection.results == null)
	{
		return this.fail(call, HmiSql.CODES.NO_ROWS_SELECTED);
	}

	return connection.results.rows.length;
};

/** SQLFirst, SQLNext, SQLPrev, SQLLast: move the cursor and fetch the row. */
HmiSqlManager.prototype.move = function(call, id, how)
{
	var connection = this.connectionOf(id);

	if (connection == null)
	{
		return this.fail(call, HmiSql.CODES.INVALID_CONNECTION);
	}

	if (connection.results == null)
	{
		return this.fail(call, HmiSql.CODES.NO_ROWS_SELECTED);
	}

	var rows = connection.results.rows;
	var at = (how === 'first') ? 0 :
		((how === 'last') ? rows.length - 1 :
		((how === 'next') ? connection.cursor + 1 : connection.cursor - 1));

	if (at < 0 || at >= rows.length)
	{
		// The cursor stays where it was, so a loop that runs off the end can
		// still ask where it is
		return this.fail(call, HmiSql.CODES.NO_MORE_ROWS);
	}

	connection.cursor = at;

	return this.fetch(call, connection);
};

/** SQLGetRecord: the row at a given number, counting from 1. */
HmiSqlManager.prototype.getRecord = function(call, id, number)
{
	var connection = this.connectionOf(id);

	if (connection == null)
	{
		return this.fail(call, HmiSql.CODES.INVALID_CONNECTION);
	}

	if (connection.results == null)
	{
		return this.fail(call, HmiSql.CODES.NO_ROWS_SELECTED);
	}

	var at = Math.round(Number(number)) - 1;

	if (!isFinite(at) || at < 0 || at >= connection.results.rows.length)
	{
		return this.fail(call, HmiSql.CODES.NO_MORE_ROWS);
	}

	connection.cursor = at;

	return this.fetch(call, connection);
};

/** SQLEnd: lets the rows go. */
HmiSqlManager.prototype.end = function(call, id)
{
	var connection = this.connectionOf(id);

	if (connection == null)
	{
		return this.fail(call, HmiSql.CODES.INVALID_CONNECTION);
	}

	connection.results = null;
	connection.cursor = -1;
	connection.bindList = '';

	return HmiSql.CODES.OK;
};

/** Writes the row the cursor is on into the bind list's tags. */
HmiSqlManager.prototype.fetch = function(call, connection)
{
	var bindList = HmiSql.bindList(this.project, connection.bindList);

	if (bindList == null)
	{
		return this.fail(call, HmiSql.CODES.NO_BIND_LIST);
	}

	var row = connection.results.rows[connection.cursor] || [];
	var writes = {};
	var nulls = 0;

	for (var i = 0; i < bindList.items.length; i++)
	{
		var item = bindList.items[i];
		var value = row[i];

		if (value == null)
		{
			nulls++;
		}

		// A dotfield is read from a tag, never written to it: the alarm state
		// of a tag is the alarm manager's to say
		if (item.field)
		{
			continue;
		}

		var tag = this.project.getTag(item.tag);

		if (tag == null)
		{
			return this.fail(call, HmiSql.CODES.INTERNAL,
				'Bind list "' + bindList.name + '" names the tag "' + item.tag + '", which does not exist.');
		}

		writes[tag.name] = HmiSql.coerceForTag(tag, value);
	}

	if (Object.keys(writes).length > 0)
	{
		this.driver.write(writes);
	}

	// A null column is not a result. The row was delivered -- the tag holds 0
	// or no text -- so the fetch succeeded, and a
	// WHILE SQLNext(id) == 0 ... ENDWHILE walk reaches the end of the
	// selection. Returning -4 here stopped such a walk at the first row with
	// a null in it, which a live walk of three batches showed: a plant
	// table's columns are nullable far too often for that. The null goes to
	// the runtime log instead, once per bind list so a long walk cannot flood
	// it, and SQLErrorMsg(-4) still has the words for a script that asks.
	if (nulls > 0)
	{
		HmiLog.once('sql:null:' + bindList.name + ':' + connection.id,
			'sql: ' + ((call != null) ? call + ': ' : '') +
			HmiSql.message(HmiSql.CODES.NULL_VALUE));
	}

	return HmiSql.CODES.OK;
};

HmiSqlManager.prototype.writeTag = function(name, value)
{
	var tag = (name != null) ? this.project.getTag(name) : null;

	if (tag == null)
	{
		return;
	}

	var writes = {};
	writes[tag.name] = HmiSql.coerceForTag(tag, value);
	this.driver.write(writes);
};

/** A database value as the tag that receives it can hold it. */
HmiSql.coerceForTag = function(tag, value)
{
	if (HmiTypes.isMessage(tag.type))
	{
		return (value == null) ? '' : '' + value;
	}

	if (HmiTypes.isDiscrete(tag.type))
	{
		if (typeof value === 'string')
		{
			// A database may hold a flag as text
			return (/^(1|true|yes|on|y|t)$/i.test(value.trim())) ? 1 : 0;
		}

		return (HmiExpr.truthy(value)) ? 1 : 0;
	}

	var n = Number(value);

	if (!isFinite(n))
	{
		return 0;
	}

	return HmiTypes.isInteger(tag.type) ? Math.round(n) : n;
};

/**
 * How many rows a selection may bring back. A safety limit, not something a
 * project sets: a screen walks a selection a row at a time, and a query that
 * would return more than this is a query to narrow. The rows that do come
 * back are usable and the script is told in the Database Error window.
 */
HmiSql.maxRows = function()
{
	return HmiSql.DEFAULT_MAX_ROWS;
};

/**
 * A table or column name as a statement can carry it. A name that is a plain
 * identifier is left alone; anything else is bracketed, which both databases
 * accept. A name already bracketed or qualified is left as the script wrote
 * it.
 */
HmiSql.quoteColumn = function(name)
{
	var text = '' + (name == null ? '' : name);

	if (text === '' || /^[\[\]"`]/.test(text) || text.indexOf('.') >= 0)
	{
		return text;
	}

	return HmiSql.needsBrackets(text) ? '[' + text.replace(/]/g, ']]') + ']' : text;
};
