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

/**
 * Which item of a bind list writes a column, or -1. The names are compared
 * as the database gives them back, so a bracketed column in the bind list
 * still matches.
 */
HmiSql.columnAt = function(bindList, column)
{
	var want = HmiSql.bareColumn(column);
	var items = (bindList != null) ? (bindList.items || []) : [];

	for (var i = 0; i < items.length; i++)
	{
		if (HmiSql.bareColumn(items[i].column) === want)
		{
			return i;
		}
	}

	return -1;
};

/** A column name without its brackets or quotes, lower case. */
HmiSql.bareColumn = function(name)
{
	return ('' + (name == null ? '' : name)).trim()
		.replace(/^[\[\"`]/, '').replace(/[\]\"`]$/, '').toLowerCase();
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

		// A dotfield is checked here rather than in Validate alone, so the
		// dialog refuses to save one and the command line refuses to build
		// one: it is a rule about the name, not about the project
		var field = '' + (items[i].field == null ? '' : items[i].field);

		if (field.trim() !== '' && !HmiTypes.DOTFIELDS[field.trim()])
		{
			return '"' + field.trim() + '" is not one of a tag\'s fields.';
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
	FILE_NOT_ALLOWED: -1107,
	ROW_GONE: -1108,
	NO_STATEMENT: -1109
};

HmiSql.MESSAGES = {
	0: 'No errors occurred',
	'-1': 'The database reported an error',
	'-2': 'There is no statement to execute',
	'-4': 'The value read was null',
	'-5': 'There are no more rows to fetch',
	'-7': 'That parameter number is not valid',
	'-8': "The statement's parameters have not all been set",
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
	'-1107': 'A database file must be in Documents or the application data folder',
	'-1108': 'The row the cursor is on is no longer in the table',
	'-1109': 'There is no prepared statement of that number'
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
	'SQLPrev', 'SQLLast', 'SQLGetRecord', 'SQLNumRows', 'SQLEnd', 'SQLErrorMsg',
	'SQLInsert', 'SQLUpdate', 'SQLUpdateCurrent', 'SQLDelete', 'SQLClearTable',
	'SQLCreateTable', 'SQLDropTable',
	'SQLSetStatement', 'SQLAppendStatement', 'SQLLoadStatement', 'SQLPrepareStatement',
	'SQLSetParamChar', 'SQLSetParamDate', 'SQLSetParamDateTime', 'SQLSetParamDecimal',
	'SQLSetParamFloat', 'SQLSetParamInt', 'SQLSetParamLong', 'SQLSetParamNull',
	'SQLSetParamTime', 'SQLClearParam', 'SQLExecute', 'SQLClearStatement',
	'SQLInsertPrepare', 'SQLInsertExecute', 'SQLInsertEnd',
	'SQLTransact', 'SQLCommit', 'SQLRollback'];

/** The ones that reach a database and so pause the script. */
HmiSql.ASYNC_FUNCTIONS = ['SQLConnect', 'SQLDisconnect', 'SQLSelect',
	'SQLInsert', 'SQLUpdate', 'SQLUpdateCurrent', 'SQLDelete', 'SQLClearTable',
	'SQLCreateTable', 'SQLDropTable', 'SQLExecute', 'SQLInsertExecute',
	'SQLTransact', 'SQLCommit', 'SQLRollback'];

/** The SQLSetParam* family, which addresses a statement and not a connection. */
HmiSql.PARAM_FUNCTIONS = ['SQLSetParamChar', 'SQLSetParamDate', 'SQLSetParamDateTime',
	'SQLSetParamDecimal', 'SQLSetParamFloat', 'SQLSetParamInt', 'SQLSetParamLong',
	'SQLSetParamNull', 'SQLSetParamTime'];

HmiSql.isFunction = function(name)
{
	return mxUtils.indexOf(HmiSql.FUNCTIONS, name) >= 0;
};

HmiSql.isAsyncFunction = function(name)
{
	return mxUtils.indexOf(HmiSql.ASYNC_FUNCTIONS, name) >= 0;
};

/**
 * Which argument of which call names one of the project's database sections,
 * so a literal name can be checked where it is written rather than when it
 * runs -- the way a literal window name is. `empty` marks the ones a
 * zero-length name is an answer for: SQLExecute with no bind list says the
 * rows it returns are not for tags.
 */
HmiSql.NAME_ARGS = {
	'SQLConnect': [{at: 1, kind: 'dataSource', what: 'data source'}],
	'SQLSelect': [{at: 2, kind: 'bindList', what: 'bind list'}],
	'SQLInsert': [{at: 2, kind: 'bindList', what: 'bind list'}],
	'SQLUpdate': [{at: 2, kind: 'bindList', what: 'bind list'}],
	'SQLInsertPrepare': [{at: 2, kind: 'bindList', what: 'bind list'}],
	'SQLInsertExecute': [{at: 1, kind: 'bindList', what: 'bind list', empty: true}],
	'SQLExecute': [{at: 1, kind: 'bindList', what: 'bind list', empty: true}],
	'SQLCreateTable': [{at: 2, kind: 'tableTemplate', what: 'table template'}],
	'SQLLoadStatement': [{at: 1, kind: 'query', what: 'query'}]
};

/**
 * Which argument of which call is a where expression. An empty one is
 * refused at run time, because it would act on every row in the table; a
 * literal empty one is refused at Validate.
 */
HmiSql.WHERE_ARGS = {'SQLUpdate': 3, 'SQLDelete': 2};

/** The four sections by the kind NAME_ARGS names. */
HmiSql.FINDERS = {
	dataSource: HmiSql.dataSource,
	bindList: HmiSql.bindList,
	tableTemplate: HmiSql.tableTemplate,
	query: HmiSql.query
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

	// Prepared statements by the number SQLPrepareStatement and
	// SQLInsertPrepare hand back. They are the Run's, not one connection's,
	// because the SQLSetParam* family names a statement and nothing else.
	this.statements = {};
	this.nextStatement = 1;
	this.running = false;

	// SQLErrorMsg(-1) gives the database's own words for the last failure
	this.lastProviderMessage = '';
};

/**
 * Every tag a bind list names, which is what the manager subscribes to.
 *
 * SQLInsert and SQLUpdate send the tags' current values, and those tags may
 * be on no window at all -- a batch log writes points nobody is watching. The
 * subscription is what makes the driver hold a value for them, which is where
 * read() looks; without it an insert would find nothing to send. The recipe
 * manager watches a book's tags for the same reason.
 */
HmiSqlManager.prototype.tagNames = function()
{
	var names = [];
	var lists = this.project.bindLists || [];

	for (var i = 0; i < lists.length; i++)
	{
		var items = lists[i].items || [];

		for (var j = 0; j < items.length; j++)
		{
			var name = items[j].tag;

			if (name && this.project.getTag(name) != null &&
				mxUtils.indexOf(names, name) < 0)
			{
				names.push(name);
			}
		}
	}

	return names;
};

HmiSqlManager.prototype.start = function()
{
	var that = this;
	this.running = true;
	this.values = {};
	this.onChange = function(batch)
	{
		for (var name in batch)
		{
			that.values[name.toLowerCase()] = batch[name];
		}
	};
	this.driver.on('change', this.onChange);

	var names = this.tagNames();

	if (names.length > 0)
	{
		this.driver.subscribe(names, HmiSql.BIND_RATE_MS);
	}
};

/** Closes every connection as the Run ends. */
HmiSqlManager.prototype.stop = function()
{
	this.running = false;

	if (this.onChange != null)
	{
		this.driver.off('change', this.onChange);
		this.onChange = null;
	}

	// Closing a connection rolls back whatever transaction was open on it:
	// the main process does that as it lets it go, and the database would do
	// it anyway for a connection that simply dropped
	for (var id in this.connections)
	{
		this.request('hmiSql.close', {connectionId: Number(id)}, function() {}, function() {});
	}

	this.connections = {};
	this.statements = {};
};

/**
 * A bind-list tag's current value.
 *
 * The driver's own value comes first, and the last batch delivered here is
 * only the fallback. A script sets the tags and inserts in the same pass --
 *
 *     Batch_Recipe = "Blend A"; Res = SQLInsert(ConnId, "Log", "Row");
 *
 * -- and a batch arrives on the subscription's own schedule, so reading the
 * cache first would write the values from a quarter of a second ago.
 */
HmiSqlManager.prototype.read = function(name)
{
	var v = (this.driver != null && this.driver.get != null) ?
		this.driver.get(name) : null;

	if (v == null && this.values != null)
	{
		v = this.values[('' + name).toLowerCase()];
	}

	return (v != null) ? v :
		{value: null, quality: HmiTypes.QUALITY_BAD, timestamp: 0};
};

/**
 * What one bind list item contributes: the tag's value, or what one of its
 * dotfields says about the tag.
 */
HmiSqlManager.prototype.bindValue = function(tag, field)
{
	var live = this.read(tag.name);

	if (!field || field === 'Value')
	{
		return live;
	}

	var good = {quality: HmiTypes.QUALITY_GOOD, timestamp: Date.now()};

	// Metadata describes the point, not its current reading, so it is good
	// quality even when the value is not
	if (field === 'Quality')
	{
		return {value: live.quality, quality: good.quality, timestamp: good.timestamp};
	}

	if (field === 'TimeDate')
	{
		return {value: live.timestamp, quality: good.quality, timestamp: good.timestamp};
	}

	var alarms = this.options.alarms;
	var described = HmiTypes.describe(tag,
		(alarms != null) ? alarms.isActive(tag.name) : false,
		(alarms != null) ? alarms.isAcked(tag.name) : true);

	return (described[field] !== undefined) ?
		{value: described[field], quality: good.quality, timestamp: good.timestamp} :
		{value: null, quality: HmiTypes.QUALITY_BAD, timestamp: 0};
};

/**
 * The columns and the bound values of a bind list, for an insert or the SET
 * of an update. Values are bound as parameters, never pasted into the
 * statement: a tag holding a quotation mark would otherwise rewrite it.
 *
 * @returns {Object} {columns, params} or {code, error}
 */
HmiSqlManager.prototype.bindParams = function(bindList)
{
	var columns = [];
	var params = [];
	var items = bindList.items || [];

	for (var i = 0; i < items.length; i++)
	{
		var item = items[i];
		var tag = (item.tag) ? this.project.getTag(item.tag) : null;

		if (tag == null)
		{
			return {code: HmiSql.CODES.INTERNAL, error: 'Bind list "' + bindList.name +
				'" names the tag "' + item.tag + '", which does not exist.'};
		}

		if (!item.column)
		{
			return {code: HmiSql.CODES.NO_BIND_LIST, error: 'Bind list "' + bindList.name +
				'" has no column for the tag "' + item.tag + '".'};
		}

		var v = this.bindValue(tag, item.field);

		// Bad quality is written as a null rather than stopping the insert:
		// one tag of twenty may be on a link that is down, and a record with
		// a null in it still says what was known. A NOT NULL column makes the
		// database refuse it, which is the schema's decision to make.
		if (v.quality <= HmiTypes.QUALITY_BAD)
		{
			HmiLog.once('sql:bad:' + bindList.name + ':' + tag.name,
				'sql: the value of "' + tag.name + '" is bad quality, so "' +
				item.column + '" is written as null');
		}

		columns.push(HmiSql.quoteColumn(item.column));
		params.push(HmiSql.paramFor(tag, item.field, v));
	}

	return {columns: columns, params: params};
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
		case 'SQLSetStatement':
			return this.setStatement(call, args[0], args[1], false);
		case 'SQLAppendStatement':
			return this.setStatement(call, args[0], args[1], true);
		case 'SQLLoadStatement':
			return this.loadStatement(call, args[0], args[1]);
		case 'SQLPrepareStatement':
			return this.prepareStatement(call, args[0], args[1]);
		case 'SQLClearStatement':
			return this.clearStatement(call, args[0], args[1]);
		case 'SQLInsertPrepare':
			return this.insertPrepare(call, args);
		case 'SQLInsertEnd':
			return this.insertEnd(call, args[0], args[1]);
		case 'SQLClearParam':
			return this.clearParam(call, args);
	}

	if (mxUtils.indexOf(HmiSql.PARAM_FUNCTIONS, name) >= 0)
	{
		return this.setParam(call, name, args);
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
		case 'SQLInsert':
			this.insert(call, args, done);

			return;
		case 'SQLUpdate':
			this.update(call, args, done);

			return;
		case 'SQLUpdateCurrent':
			this.updateCurrent(call, args[0], done);

			return;
		case 'SQLDelete':
			this.remove(call, args, done);

			return;
		case 'SQLClearTable':
			this.clearTable(call, args, done);

			return;
		case 'SQLCreateTable':
			this.createTable(call, args, done);

			return;
		case 'SQLDropTable':
			this.dropTable(call, args, done);

			return;
		case 'SQLExecute':
			this.execute(call, args, done);

			return;
		case 'SQLInsertExecute':
			this.insertExecute(call, args, done);

			return;
		case 'SQLTransact':
			this.transact(call, args[0], 'begin', done);

			return;
		case 'SQLCommit':
			this.transact(call, args[0], 'commit', done);

			return;
		case 'SQLRollback':
			this.transact(call, args[0], 'rollback', done);

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
				provider: res.provider, results: null, cursor: -1, bindList: '',
				statement: '', inTransaction: false};
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
	this.dropStatements(connection.id);

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
			// SQLUpdateCurrent writes back to the table this came from
			connection.table = table;

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

/**
 * Runs one statement and hands the script a result code. `then` sees the
 * answer where "it worked" is not enough -- how many rows an update touched,
 * say.
 */
HmiSqlManager.prototype.exec = function(call, connection, sql, params, done, then)
{
	var that = this;

	this.request('hmiSql.exec', {connectionId: connection.id, sql: sql,
		params: params || [], maxRows: HmiSql.maxRows()},
		function(res)
		{
			if (res == null || res.code !== HmiSql.CODES.OK)
			{
				done(that.fail(call, (res != null) ? res.code : HmiSql.CODES.INTERNAL,
					(res != null) ? res.message : null));

				return;
			}

			if (then != null)
			{
				then(res);

				return;
			}

			done(HmiSql.CODES.OK);
		},
		function(e)
		{
			done(that.fail(call, HmiSql.CODES.PROVIDER_ERROR, e.message));
		});
};

/** Runs statements one after another, stopping at the first failure. */
HmiSqlManager.prototype.execAll = function(call, connection, list, done)
{
	var that = this;
	var at = 0;

	var next = function()
	{
		if (at >= list.length)
		{
			done(HmiSql.CODES.OK);

			return;
		}

		that.exec(call, connection, list[at++], [], done, function() { next(); });
	};

	next();
};

/**
 * The connection, the table name and the bind list a statement needs, or the
 * failure that stops it. Four of the calls begin exactly this way.
 */
HmiSqlManager.prototype.target = function(call, id, tableArg, bindArg, what)
{
	var connection = this.connectionOf(id);

	if (connection == null)
	{
		return {code: this.fail(call, HmiSql.CODES.INVALID_CONNECTION)};
	}

	var table = ('' + (tableArg == null ? '' : tableArg)).trim();

	if (table === '')
	{
		return {code: this.fail(call, HmiSql.CODES.EMPTY_STATEMENT,
			what + ' needs the name of a table.')};
	}

	if (bindArg === undefined)
	{
		return {connection: connection, table: table};
	}

	var name = '' + (bindArg == null ? '' : bindArg);
	var bindList = HmiSql.bindList(this.project, name);

	if (bindList == null)
	{
		return {code: this.fail(call, HmiSql.CODES.NO_BIND_LIST,
			'There is no bind list named "' + name + '".')};
	}

	return {connection: connection, table: table, bindList: bindList};
};

/**
 * SQLInsert(ConnectionID, TableName, BindList): one new row from the current
 * values of the bind list's tags.
 */
HmiSqlManager.prototype.insert = function(call, args, done)
{
	var to = this.target(call, args[0], args[1], args[2], 'SQLInsert');

	if (to.connection == null)
	{
		done(to.code);

		return;
	}

	var bound = this.bindParams(to.bindList);

	if (bound.error != null)
	{
		done(this.fail(call, bound.code, bound.error));

		return;
	}

	if (bound.columns.length === 0)
	{
		done(this.fail(call, HmiSql.CODES.NO_BIND_LIST,
			'Bind list "' + to.bindList.name + '" has no tags in it.'));

		return;
	}

	var marks = bound.columns.map(function() { return '?'; });
	var sql = 'INSERT INTO ' + HmiSql.quoteColumn(to.table) + ' (' +
		bound.columns.join(', ') + ') VALUES (' + marks.join(', ') + ')';

	this.exec(call, to.connection, sql, bound.params, done);
};

/**
 * SQLUpdate(ConnectionID, TableName, BindList, WhereExpr): the current tag
 * values into every row the where expression matches.
 *
 * An empty where expression is refused. In a statement built by hand it is a
 * syntax error; here it would quietly rewrite every row in the table, and
 * nothing a script can pass should do that by accident.
 */
HmiSqlManager.prototype.update = function(call, args, done)
{
	var to = this.target(call, args[0], args[1], args[2], 'SQLUpdate');

	if (to.connection == null)
	{
		done(to.code);

		return;
	}

	var where = ('' + (args[3] == null ? '' : args[3])).trim();

	if (where === '')
	{
		done(this.fail(call, HmiSql.CODES.NO_WHERE_CLAUSE,
			'SQLUpdate needs a where expression, so that it cannot change every row at once.'));

		return;
	}

	var bound = this.bindParams(to.bindList);

	if (bound.error != null)
	{
		done(this.fail(call, bound.code, bound.error));

		return;
	}

	if (bound.columns.length === 0)
	{
		done(this.fail(call, HmiSql.CODES.NO_BIND_LIST,
			'Bind list "' + to.bindList.name + '" has no tags in it.'));

		return;
	}

	var sets = bound.columns.map(function(column) { return column + ' = ?'; });
	var sql = 'UPDATE ' + HmiSql.quoteColumn(to.table) + ' SET ' + sets.join(', ') +
		' WHERE ' + where;

	this.exec(call, to.connection, sql, bound.params, done);
};

/**
 * SQLUpdateCurrent(ConnectionID): the current tag values into the row the
 * cursor is on, in the table and through the bind list the selection used.
 *
 * There is no row identity to work from -- a selection is columns and values,
 * not keys -- so the row is found again by matching every column it was
 * fetched with. Rows identical to it are therefore updated too, and a table
 * meant for this should carry a key column in its bind list. The local copy
 * of the row is updated with what was written, so a second call still finds
 * it.
 */
HmiSqlManager.prototype.updateCurrent = function(call, id, done)
{
	var connection = this.connectionOf(id);

	if (connection == null)
	{
		done(this.fail(call, HmiSql.CODES.INVALID_CONNECTION));

		return;
	}

	if (connection.results == null || !connection.table)
	{
		done(this.fail(call, HmiSql.CODES.NO_ROWS_SELECTED,
			(connection.results != null) ?
			'SQLUpdateCurrent writes back to the table SQLSelect named, and these rows came ' +
			'from a statement of the script\'s own.' : null));

		return;
	}

	var row = connection.results.rows[connection.cursor];

	if (row == null)
	{
		done(this.fail(call, HmiSql.CODES.NO_MORE_ROWS,
			'SQLUpdateCurrent needs the cursor to be on a row: call SQLFirst first.'));

		return;
	}

	var bindList = HmiSql.bindList(this.project, connection.bindList);

	if (bindList == null)
	{
		done(this.fail(call, HmiSql.CODES.NO_BIND_LIST));

		return;
	}

	var bound = this.bindParams(bindList);

	if (bound.error != null)
	{
		done(this.fail(call, bound.code, bound.error));

		return;
	}

	var columns = connection.results.columns || [];
	var tests = [];
	var params = bound.params.slice();

	for (var i = 0; i < columns.length && i < row.length; i++)
	{
		var column = HmiSql.quoteColumn(columns[i].name);

		if (row[i] == null)
		{
			tests.push(column + ' IS NULL');
		}
		else
		{
			tests.push(column + ' = ?');
			params.push(HmiSql.paramOf(row[i]));
		}
	}

	if (tests.length === 0 || bound.columns.length === 0)
	{
		done(this.fail(call, HmiSql.CODES.NO_BIND_LIST,
			'Bind list "' + bindList.name + '" has no tags in it.'));

		return;
	}

	var sets = bound.columns.map(function(column) { return column + ' = ?'; });
	var sql = 'UPDATE ' + HmiSql.quoteColumn(connection.table) + ' SET ' +
		sets.join(', ') + ' WHERE ' + tests.join(' AND ');
	var that = this;

	this.exec(call, connection, sql, params, done, function(res)
	{
		if (!(res.rowsAffected > 0))
		{
			done(that.fail(call, HmiSql.CODES.ROW_GONE));

			return;
		}

		// Keep the row that is held here in step with the table, so walking
		// on and coming back shows what was written
		for (var c = 0; c < columns.length && c < row.length; c++)
		{
			var at = HmiSql.columnAt(bindList, columns[c].name);

			if (at >= 0)
			{
				var param = bound.params[at];
				row[c] = (param.type === 'null') ? null : param.value;
			}
		}

		done(HmiSql.CODES.OK);
	});
};

/**
 * SQLDelete(ConnectionID, TableName, WhereExpr): the rows the where
 * expression matches. An empty one is refused, as it is for an update:
 * SQLClearTable is how a script empties a table deliberately.
 */
HmiSqlManager.prototype.remove = function(call, args, done)
{
	var to = this.target(call, args[0], args[1], undefined, 'SQLDelete');

	if (to.connection == null)
	{
		done(to.code);

		return;
	}

	var where = ('' + (args[2] == null ? '' : args[2])).trim();

	if (where === '')
	{
		done(this.fail(call, HmiSql.CODES.NO_WHERE_CLAUSE,
			'SQLDelete needs a where expression. SQLClearTable empties a table.'));

		return;
	}

	this.exec(call, to.connection, 'DELETE FROM ' + HmiSql.quoteColumn(to.table) +
		' WHERE ' + where, [], done);
};

/**
 * SQLClearTable(ConnectionID, TableName): every row, and the table itself
 * stays. DELETE rather than TRUNCATE: TRUNCATE is SQL Server's alone and it
 * refuses a table another table refers to.
 */
HmiSqlManager.prototype.clearTable = function(call, args, done)
{
	var to = this.target(call, args[0], args[1], undefined, 'SQLClearTable');

	if (to.connection == null)
	{
		done(to.code);

		return;
	}

	this.exec(call, to.connection, 'DELETE FROM ' + HmiSql.quoteColumn(to.table), [], done);
};

/**
 * SQLCreateTable(ConnectionID, TableName, TemplateName): a table shaped by
 * one of the project's table templates, and an index for each column that
 * asks for one.
 */
HmiSqlManager.prototype.createTable = function(call, args, done)
{
	var to = this.target(call, args[0], args[1], undefined, 'SQLCreateTable');

	if (to.connection == null)
	{
		done(to.code);

		return;
	}

	var name = '' + (args[2] == null ? '' : args[2]);
	var template = HmiSql.tableTemplate(this.project, name);

	if (template == null)
	{
		done(this.fail(call, HmiSql.CODES.NO_TEMPLATE,
			'There is no table template named "' + name + '".'));

		return;
	}

	var columns = (template.columns || []).filter(function(c) { return !!c.name; });

	if (columns.length === 0)
	{
		done(this.fail(call, HmiSql.CODES.NO_TEMPLATE,
			'Table template "' + template.name + '" has no columns.'));

		return;
	}

	this.execAll(call, to.connection,
		HmiSql.tableSql(to.connection.provider, to.table, template), done);
};

/** SQLDropTable(ConnectionID, TableName). */
HmiSqlManager.prototype.dropTable = function(call, args, done)
{
	var to = this.target(call, args[0], args[1], undefined, 'SQLDropTable');

	if (to.connection == null)
	{
		done(to.code);

		return;
	}

	this.exec(call, to.connection, 'DROP TABLE ' + HmiSql.quoteColumn(to.table), [], done);
};

// ------------------------------------------- statements a script builds

/**
 * SQLSetStatement(ConnectionID, SQLStatement) starts the statement buffer the
 * connection carries, and SQLAppendStatement(ConnectionID, SQLStatement)
 * continues it. There is one buffer per connection.
 *
 * Nothing is put between the pieces: a statement is as often continued in the
 * middle of a name or a quoted value as between words, so the spaces are the
 * script's to place.
 */
HmiSqlManager.prototype.setStatement = function(call, id, text, append)
{
	var connection = this.connectionOf(id);

	if (connection == null)
	{
		return this.fail(call, HmiSql.CODES.INVALID_CONNECTION);
	}

	var next = (append ? (connection.statement || '') : '') +
		('' + (text == null ? '' : text));

	if (next.length > HmiSql.MAX_STATEMENT)
	{
		return this.fail(call, HmiSql.CODES.OUT_OF_MEMORY,
			'A statement may be up to ' + HmiSql.MAX_STATEMENT + ' characters long.');
	}

	connection.statement = next;

	return HmiSql.CODES.OK;
};

/**
 * SQLLoadStatement(ConnectionID, QueryName): the statement buffer from one of
 * the project's named queries.
 *
 * A query lives in the project rather than in a file beside the application:
 * a path names one machine's disk, and a published application runs on
 * another PC under another account. The Queries tab of the Database dialog is
 * where the statement is written, and it travels with the project.
 */
HmiSqlManager.prototype.loadStatement = function(call, id, which)
{
	var connection = this.connectionOf(id);

	if (connection == null)
	{
		return this.fail(call, HmiSql.CODES.INVALID_CONNECTION);
	}

	var name = '' + (which == null ? '' : which);
	var query = HmiSql.query(this.project, name);

	if (query == null)
	{
		return this.fail(call, HmiSql.CODES.NO_QUERY,
			'There is no query named "' + name + '".');
	}

	connection.statement = '' + (query.sql || '');

	return HmiSql.CODES.OK;
};

/** How many statements this Run holds prepared. */
HmiSqlManager.prototype.countStatements = function()
{
	var n = 0;

	for (var id in this.statements)
	{
		n++;
	}

	return n;
};

/** Everything a connection had prepared goes when the connection does. */
HmiSqlManager.prototype.dropStatements = function(connectionId)
{
	for (var id in this.statements)
	{
		if (this.statements[id].connectionId === connectionId)
		{
			delete this.statements[id];
		}
	}
};

/**
 * A statement number for this Run, with the number of parameters the
 * statement wants. The numbers count up and are not used again, as the
 * connection numbers do.
 */
HmiSqlManager.prototype.newStatement = function(call, connection, sql, kind, bindList)
{
	if (this.countStatements() >= HmiSql.MAX_STATEMENTS)
	{
		return {code: this.fail(call, HmiSql.CODES.OUT_OF_MEMORY,
			'More than ' + HmiSql.MAX_STATEMENTS + ' statements are prepared at once. ' +
			'SQLClearStatement and SQLInsertEnd let one go.')};
	}

	var count = HmiSql.countPlaceholders(sql);

	if (count > HmiSql.MAX_PARAMS)
	{
		return {code: this.fail(call, HmiSql.CODES.INVALID_PARAM_ID,
			'A statement may have up to ' + HmiSql.MAX_PARAMS + ' parameters; this one has ' +
			count + '.')};
	}

	var statement = {id: this.nextStatement++, connectionId: connection.id, sql: sql,
		kind: kind, bindList: bindList || '', count: count, params: {}, executed: false};
	this.statements[statement.id] = statement;

	return {statement: statement};
};

/**
 * SQLPrepareStatement(ConnectionID, StatementID): the buffer becomes a
 * statement with a number of its own, so its parameters can be set and it can
 * be run more than once. The number goes into the named tag, as the
 * connection number does.
 *
 * Nothing is sent to the database here. Every execution travels as a
 * parameterized statement, which is the form the driver itself prepares;
 * what this call provides is the identity the SQLSetParam* family addresses,
 * and the parameter count to check what it is given against.
 */
HmiSqlManager.prototype.prepareStatement = function(call, id, tagName)
{
	var connection = this.connectionOf(id);

	if (connection == null)
	{
		return this.fail(call, HmiSql.CODES.INVALID_CONNECTION);
	}

	var sql = (connection.statement || '').trim();

	if (sql === '')
	{
		return this.fail(call, HmiSql.CODES.EMPTY_STATEMENT,
			'SQLPrepareStatement needs a statement: SQLSetStatement or SQLLoadStatement makes one.');
	}

	var made = this.newStatement(call, connection, sql, 'statement', '');

	if (made.statement == null)
	{
		return made.code;
	}

	this.writeTag(tagName, made.statement.id);

	return HmiSql.CODES.OK;
};

/**
 * A prepared statement by its number, or the failure that stops the call.
 * `kind` asks for one sort of statement: an insert prepared by
 * SQLInsertPrepare takes its values from its bind list, so the parameter
 * family has nothing to say to it, and SQLExecute does not run it.
 */
HmiSqlManager.prototype.statementOf = function(call, which, name, kind)
{
	var n = Math.round(Number(which));
	var statement = (isFinite(n) && n > 0) ? this.statements[n] : null;

	if (statement == null)
	{
		return {code: this.fail(call, HmiSql.CODES.NO_STATEMENT,
			name + ' needs the statement number its prepare call gave it.')};
	}

	if (kind != null && statement.kind !== kind)
	{
		return {code: this.fail(call, HmiSql.CODES.INVALID_STATEMENT_TYPE,
			(statement.kind === 'insert') ?
			'Statement ' + statement.id + ' is an insert prepared with SQLInsertPrepare: ' +
			'SQLInsertExecute runs it, from the values of its bind list.' :
			'Statement ' + statement.id + ' is not an insert prepared with SQLInsertPrepare.')};
	}

	return {statement: statement};
};

/**
 * The SQLSetParam* family: SQLSetParamChar(StatementID, ParameterNumber,
 * Value[, MaxLength]) and its relatives, filling in the ? marks of a prepared
 * statement one at a time.
 *
 * A parameter keeps the type it was first given. The statement was prepared
 * for a shape, and a column that took a number last time round does not want
 * text this time; SQLClearParam forgets a parameter, so a different type may
 * then be set. Character values are the exception and concatenate, which is
 * how a value longer than a script's own text handling is assembled.
 */
HmiSqlManager.prototype.setParam = function(call, name, args)
{
	var found = this.statementOf(call, args[0], name, 'statement');

	if (found.statement == null)
	{
		return found.code;
	}

	var statement = found.statement;
	var number = this.paramNumber(call, statement, args[1], name);

	if (number < 0)
	{
		return HmiSql.CODES.INVALID_PARAM_ID;
	}

	var made = this.paramOfCall(call, name, args);

	if (made.param == null)
	{
		return made.code;
	}

	var param = made.param;
	var already = statement.params[number];

	// Once the statement has run, setting a parameter again starts its value
	// afresh: a loop running a prepared statement a row at a time sets the
	// same parameters each pass, and adding to what the last pass used is
	// nobody's intention
	var afterRun = statement.executed;

	// A statement that has run can be run again with other values, but a
	// parameter it never had cannot appear now: the marks are in the
	// statement, and the number of them does not change
	if (already == null && statement.executed)
	{
		return this.fail(call, HmiSql.CODES.PARAM_AFTER_EXECUTE,
			'Parameter ' + number + ' was not set before statement ' + statement.id +
			' ran, so it cannot be added now.');
	}

	if (already != null && already.type !== param.type)
	{
		return this.fail(call, HmiSql.CODES.PARAM_TYPE_CHANGED,
			'Parameter ' + number + ' of statement ' + statement.id + ' was set as ' +
			already.type + ', so it cannot now be set as ' + param.type +
			'. SQLClearParam forgets it.');
	}

	// A character parameter set again adds to what is there, and a piece of
	// no length adds nothing
	if (name === 'SQLSetParamChar' && already != null && !afterRun)
	{
		param.value = already.value + param.value;
	}

	statement.params[number] = param;

	return HmiSql.CODES.OK;
};

/** The parameter number a call names, or -1 with the failure reported. */
HmiSqlManager.prototype.paramNumber = function(call, statement, which, name)
{
	var number = Math.round(Number(which));

	if (!isFinite(number) || number < 1 || number > statement.count)
	{
		this.fail(call, HmiSql.CODES.INVALID_PARAM_ID,
			'Statement ' + statement.id + ' has ' + statement.count + ' parameter' +
			((statement.count === 1) ? '' : 's') + ', so ' + which + ' is not one of them.');

		return -1;
	}

	return number;
};

/** The bound value one of the SQLSetParam* calls asks for. */
HmiSqlManager.prototype.paramOfCall = function(call, name, args)
{
	var value = args[2];
	var number = function(that, type)
	{
		var n = Number(value);

		if (!isFinite(n))
		{
			return {code: that.fail(call, HmiSql.CODES.INVALID_DECIMAL,
				'"' + value + '" is not a number.')};
		}

		return {param: {type: type, value: (type === 'double') ? n : Math.round(n)}};
	};

	var when = function(that, type, precision)
	{
		var d = HmiSql.parseDateTime(value);

		if (d == null)
		{
			return {code: that.fail(call, HmiSql.CODES.INVALID_DATETIME,
				'"' + value + '" is not a date or a time.')};
		}

		if (type === 'date')
		{
			// A date parameter carries no time of day, as the call form says
			d = new Date(d.getFullYear(), d.getMonth(), d.getDate());
		}
		else if (precision != null)
		{
			d = HmiSql.datePrecision(d, precision);
		}

		return {param: {type: type, value: d}};
	};

	switch (name)
	{
		case 'SQLSetParamChar':
			// MaxLength told the legacy driver which of two character types
			// to use; a bound parameter needs no such choice, so it is
			// accepted and ignored
			return {param: {type: 'varchar', value: '' + (value == null ? '' : value)}};

		case 'SQLSetParamDate':
			return when(this, 'date');

		case 'SQLSetParamDateTime':
			return when(this, 'datetime', args[3]);

		case 'SQLSetParamTime':
			return when(this, 'time');

		case 'SQLSetParamFloat':
			return number(this, 'double');

		case 'SQLSetParamInt':
			return number(this, 'int');

		case 'SQLSetParamLong':
			return number(this, 'long');

		case 'SQLSetParamDecimal':
			if (!isFinite(Number(value)))
			{
				return {code: this.fail(call, HmiSql.CODES.INVALID_DECIMAL,
					'"' + value + '" is not a decimal number.')};
			}

			return {param: HmiSql.decimalParam(value, args[3], args[4])};

		case 'SQLSetParamNull':
			var kind = HmiSql.NULL_PARAM_TYPES[Math.round(Number(value))];

			if (kind == null)
			{
				return {code: this.fail(call, HmiSql.CODES.INVALID_NULL_TYPE,
					'A null parameter is 0 text, 1 a date and time, 2 a whole number, ' +
					'3 a floating point number or 4 a decimal, not "' + value + '".')};
			}

			var nullParam = {type: 'null', nullType: kind};

			if (kind === 'decimal')
			{
				var declared = HmiSql.decimalParam(0, args[3], args[4]);
				nullParam.precision = declared.precision;
				nullParam.scale = declared.scale;
			}

			return {param: nullParam};
	}

	return {code: this.fail(call, HmiSql.CODES.INTERNAL)};
};

/**
 * SQLClearParam(StatementID, ParameterNumber): the parameter is unset, so it
 * must be given a value again -- of whatever type this time -- before the
 * statement runs.
 */
HmiSqlManager.prototype.clearParam = function(call, args)
{
	var found = this.statementOf(call, args[0], 'SQLClearParam', 'statement');

	if (found.statement == null)
	{
		return found.code;
	}

	var number = this.paramNumber(call, found.statement, args[1], 'SQLClearParam');

	if (number < 0)
	{
		return HmiSql.CODES.INVALID_PARAM_ID;
	}

	delete found.statement.params[number];

	return HmiSql.CODES.OK;
};

/**
 * SQLClearStatement(ConnectionID, StatementID): the statement and its
 * parameters are let go. Statement 0 is the connection's own buffer, which is
 * emptied.
 */
HmiSqlManager.prototype.clearStatement = function(call, id, which)
{
	var connection = this.connectionOf(id);

	if (connection == null)
	{
		return this.fail(call, HmiSql.CODES.INVALID_CONNECTION);
	}

	if (Math.round(Number(which)) === 0)
	{
		connection.statement = '';

		return HmiSql.CODES.OK;
	}

	var found = this.statementOf(call, which, 'SQLClearStatement');

	if (found.statement == null)
	{
		return found.code;
	}

	delete this.statements[found.statement.id];

	return HmiSql.CODES.OK;
};

/**
 * The parameters of a prepared statement in the order the statement wants
 * them, or the failure that stops it: every ? has to have been given a
 * value.
 */
HmiSqlManager.prototype.paramsOf = function(call, statement)
{
	var params = [];

	for (var i = 1; i <= statement.count; i++)
	{
		if (statement.params[i] == null)
		{
			return {code: this.fail(call, HmiSql.CODES.INVALID_PARAM_LIST,
				'Parameter ' + i + ' of statement ' + statement.id + ' has not been set.')};
		}

		params.push(statement.params[i]);
	}

	return {params: params};
};

/**
 * SQLExecute(ConnectionID, BindList, StatementID): runs a statement the
 * script built. Statement 0 is the connection's buffer, run as it stands and
 * emptied afterwards; any other number is a prepared statement, which can be
 * run again with other parameter values.
 *
 * A statement that returns rows fills the results table, to be walked with
 * SQLFirst and the rest through the bind list named here. A zero-length bind
 * list is the documented way of saying the statement returns nothing of
 * interest, or that its rows are not for tags; the rows are still counted by
 * SQLNumRows.
 *
 * A statement that returns no rows at all -- an INSERT, or SET
 * IDENTITY_INSERT -- leaves a selection already in hand alone, so a script
 * can run one in the middle of walking another's rows.
 */
HmiSqlManager.prototype.execute = function(call, args, done)
{
	var that = this;
	var connection = this.connectionOf(args[0]);

	if (connection == null)
	{
		done(this.fail(call, HmiSql.CODES.INVALID_CONNECTION));

		return;
	}

	var bindName = '' + (args[1] == null ? '' : args[1]);
	var bindList = null;

	if (bindName !== '')
	{
		bindList = HmiSql.bindList(this.project, bindName);

		if (bindList == null)
		{
			done(this.fail(call, HmiSql.CODES.NO_BIND_LIST,
				'There is no bind list named "' + bindName + '".'));

			return;
		}
	}

	var which = Math.round(Number(args[2]));
	var statement = null;
	var sql = '';
	var params = [];

	if (!isFinite(which) || which === 0)
	{
		sql = (connection.statement || '').trim();

		if (sql === '')
		{
			done(this.fail(call, HmiSql.CODES.EMPTY_STATEMENT,
				'SQLExecute was given statement 0, and the connection has no statement in it. ' +
				'SQLSetStatement or SQLLoadStatement makes one.'));

			return;
		}

		// Parameters belong to a prepared statement: the marks of an
		// unprepared one have nothing to fill them
		if (HmiSql.countPlaceholders(sql) > 0)
		{
			done(this.fail(call, HmiSql.CODES.INVALID_PARAM_LIST,
				'The statement has parameters in it, so it must be prepared with ' +
				'SQLPrepareStatement and filled in before it runs.'));

			return;
		}
	}
	else
	{
		var found = this.statementOf(call, which, 'SQLExecute', 'statement');

		if (found.statement == null)
		{
			done(found.code);

			return;
		}

		statement = found.statement;

		if (statement.connectionId !== connection.id)
		{
			done(this.fail(call, HmiSql.CODES.INVALID_CONNECTION,
				'Statement ' + statement.id + ' was prepared on another connection.'));

			return;
		}

		var gathered = this.paramsOf(call, statement);

		if (gathered.params == null)
		{
			done(gathered.code);

			return;
		}

		sql = statement.sql;
		params = gathered.params;
	}

	this.exec(call, connection, sql, params, done, function(res)
	{
		if (statement != null)
		{
			statement.executed = true;
		}
		else
		{
			// An unprepared statement runs once, as its call form says: the
			// buffer is consumed, and a second SQLExecute has nothing to run
			connection.statement = '';
		}

		if ((res.columns || []).length > 0)
		{
			connection.results = {columns: res.columns, rows: res.rows || []};
			connection.cursor = -1;
			connection.bindList = (bindList != null) ? bindList.name : '';
			// SQLUpdateCurrent writes back to the table a SQLSelect named,
			// and a statement of a script's own does not name one
			connection.table = '';

			if (res.truncated)
			{
				that.report(call, HmiSql.message(HmiSql.CODES.TOO_MANY_ROWS) + ' (' +
					connection.results.rows.length + ' kept).');
			}
		}

		done(HmiSql.CODES.OK);
	});
};

/**
 * SQLInsertPrepare(ConnectionID, TableName, BindList, StatementID): the
 * insert a bind list describes, built once and kept by number, so a loop
 * writing a row per pass does not build it again each time.
 *
 * As with SQLPrepareStatement, nothing is sent to the database here; it is
 * SQLInsertExecute that reads the tags and writes the row.
 */
HmiSqlManager.prototype.insertPrepare = function(call, args)
{
	var to = this.target(call, args[0], args[1], args[2], 'SQLInsertPrepare');

	if (to.connection == null)
	{
		return to.code;
	}

	var columns = this.bindColumns(to.bindList);

	if (columns.error != null)
	{
		return this.fail(call, columns.code, columns.error);
	}

	var marks = columns.columns.map(function() { return '?'; });
	var sql = 'INSERT INTO ' + HmiSql.quoteColumn(to.table) + ' (' +
		columns.columns.join(', ') + ') VALUES (' + marks.join(', ') + ')';
	var made = this.newStatement(call, to.connection, sql, 'insert', to.bindList.name);

	if (made.statement == null)
	{
		return made.code;
	}

	this.writeTag(args[3], made.statement.id);

	return HmiSql.CODES.OK;
};

/**
 * SQLInsertExecute(ConnectionID, BindList, StatementID): one row from the
 * current values of the prepared insert's bind list.
 *
 * The columns are the ones the statement was prepared with, so the bind list
 * named here must be that same list -- or nothing at all, which means the
 * same thing. Another list would have other columns, and the statement
 * cannot take them.
 */
HmiSqlManager.prototype.insertExecute = function(call, args, done)
{
	var connection = this.connectionOf(args[0]);

	if (connection == null)
	{
		done(this.fail(call, HmiSql.CODES.INVALID_CONNECTION));

		return;
	}

	var found = this.statementOf(call, args[2], 'SQLInsertExecute', 'insert');

	if (found.statement == null)
	{
		done(found.code);

		return;
	}

	var statement = found.statement;

	if (statement.connectionId !== connection.id)
	{
		done(this.fail(call, HmiSql.CODES.INVALID_CONNECTION,
			'Statement ' + statement.id + ' was prepared on another connection.'));

		return;
	}

	var bindName = '' + (args[1] == null ? '' : args[1]);

	if (bindName !== '' && bindName.toLowerCase() !== statement.bindList.toLowerCase())
	{
		done(this.fail(call, HmiSql.CODES.INVALID_STATEMENT_TYPE,
			'Statement ' + statement.id + ' was prepared for bind list "' + statement.bindList +
			'", so it cannot insert from "' + bindName + '".'));

		return;
	}

	var bindList = HmiSql.bindList(this.project, statement.bindList);

	if (bindList == null)
	{
		done(this.fail(call, HmiSql.CODES.NO_BIND_LIST,
			'There is no bind list named "' + statement.bindList + '".'));

		return;
	}

	var bound = this.bindParams(bindList);

	if (bound.error != null)
	{
		done(this.fail(call, bound.code, bound.error));

		return;
	}

	if (bound.columns.length !== statement.count)
	{
		done(this.fail(call, HmiSql.CODES.INVALID_STATEMENT_TYPE,
			'Bind list "' + bindList.name + '" no longer has the ' + statement.count +
			' columns statement ' + statement.id + ' was prepared for.'));

		return;
	}

	this.exec(call, connection, statement.sql, bound.params, done, function()
	{
		statement.executed = true;
		done(HmiSql.CODES.OK);
	});
};

/** SQLInsertEnd(ConnectionID, StatementID): the prepared insert is let go. */
HmiSqlManager.prototype.insertEnd = function(call, id, which)
{
	if (this.connectionOf(id) == null)
	{
		return this.fail(call, HmiSql.CODES.INVALID_CONNECTION);
	}

	var found = this.statementOf(call, which, 'SQLInsertEnd', 'insert');

	if (found.statement == null)
	{
		return found.code;
	}

	delete this.statements[found.statement.id];

	return HmiSql.CODES.OK;
};

/** The columns of a bind list, with nothing read from its tags. */
HmiSqlManager.prototype.bindColumns = function(bindList)
{
	var columns = [];
	var items = bindList.items || [];

	for (var i = 0; i < items.length; i++)
	{
		if (items[i].tag && this.project.getTag(items[i].tag) == null)
		{
			return {code: HmiSql.CODES.INTERNAL, error: 'Bind list "' + bindList.name +
				'" names the tag "' + items[i].tag + '", which does not exist.'};
		}

		if (!items[i].column)
		{
			return {code: HmiSql.CODES.NO_BIND_LIST, error: 'Bind list "' + bindList.name +
				'" has no column for the tag "' + items[i].tag + '".'};
		}

		columns.push(HmiSql.quoteColumn(items[i].column));
	}

	if (columns.length === 0)
	{
		return {code: HmiSql.CODES.NO_BIND_LIST,
			error: 'Bind list "' + bindList.name + '" has no tags in it.'};
	}

	return {columns: columns};
};

/**
 * SQLTransact(ConnectionID), SQLCommit(ConnectionID) and
 * SQLRollback(ConnectionID): everything a script writes between the first and
 * the second reaches the table together, or not at all.
 *
 * The state is kept here as well as in the main process, so that a script
 * that commits twice is told what is wrong rather than getting the
 * database's own words for it. A Run that ends with a transaction open rolls
 * it back, because closing the connection does.
 */
HmiSqlManager.prototype.transact = function(call, id, what, done)
{
	var that = this;
	var connection = this.connectionOf(id);

	if (connection == null)
	{
		done(this.fail(call, HmiSql.CODES.INVALID_CONNECTION));

		return;
	}

	if (what === 'begin' && connection.inTransaction)
	{
		done(this.fail(call, HmiSql.CODES.TRANSACTION_STATE,
			'A transaction is already open on connection ' + connection.id +
			': SQLCommit or SQLRollback ends it.'));

		return;
	}

	if (what !== 'begin' && !connection.inTransaction)
	{
		done(this.fail(call, HmiSql.CODES.TRANSACTION_STATE,
			'No transaction is open on connection ' + connection.id + ': SQLTransact starts one.'));

		return;
	}

	this.request('hmiSql.' + what, {connectionId: connection.id}, function(res)
	{
		if (res == null || res.code !== HmiSql.CODES.OK)
		{
			done(that.fail(call, (res != null) ? res.code : HmiSql.CODES.INTERNAL,
				(res != null) ? res.message : null));

			return;
		}

		connection.inTransaction = (what === 'begin');
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
	// SQLExecute may be given a zero-length bind list, which says the rows
	// are not for tags: the cursor still moves and SQLNumRows still counts
	if (connection.bindList === '')
	{
		return HmiSql.CODES.OK;
	}

	var bindList = HmiSql.bindList(this.project, connection.bindList);

	if (bindList == null)
	{
		return this.fail(call, HmiSql.CODES.NO_BIND_LIST);
	}

	var row = connection.results.rows[connection.cursor] || [];
	var writes = {};
	var nulls = 0;

	// A SQLSelect builds its statement from the bind list, so the columns
	// always line up; a statement the script wrote itself may not, and the
	// tags past the end of the row would quietly be emptied. The rows that
	// did come back are still worth having, so this is a note in the log
	// rather than a refusal.
	if ((connection.results.columns || []).length !== bindList.items.length)
	{
		HmiLog.once('sql:columns:' + bindList.name + ':' + connection.id,
			'sql: ' + ((call != null) ? call + ': ' : '') + 'the statement returned ' +
			(connection.results.columns || []).length + ' columns and bind list "' +
			bindList.name + '" has ' + bindList.items.length + ' items, so they are not ' +
			'all written');
	}

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
 * How often the manager's own client reads the bind lists' tags. The same
 * rate the recipe manager uses: fast enough that an insert records what the
 * screen was showing, slow enough to cost nothing.
 */
HmiSql.BIND_RATE_MS = 250;

/**
 * One bound value, typed from the value itself rather than from the column:
 * a statement built from a bind list says nothing about the table's types,
 * and both databases widen a number or convert text as the column needs.
 *
 * Bad quality and a missing value are both bound as a null. The tag's type
 * decides what kind of null it is, which is all the driver needs.
 */
HmiSql.paramFor = function(tag, field, v)
{
	var textField = (field === 'Name' || field === 'EngUnits' || field === 'Comment');

	if (v == null || v.value == null || v.quality <= HmiTypes.QUALITY_BAD)
	{
		return {type: 'null',
			nullType: (textField || HmiTypes.isMessage(tag.type)) ? 'varchar' : 'float'};
	}

	// .TimeDate is when the value was read, and the column it stamps is a
	// date one. Sent as the millisecond number it is, SQL Server answers
	// "arithmetic overflow converting expression to data type datetime", so
	// it goes as a time.
	if (field === 'TimeDate' && typeof v.value === 'number' && isFinite(v.value))
	{
		return {type: 'datetime', value: new Date(v.value)};
	}

	return HmiSql.paramOf(v.value);
};

/** One bound value of whatever JavaScript type it arrived as. */
HmiSql.paramOf = function(value)
{
	if (value == null)
	{
		return {type: 'null', nullType: 'varchar'};
	}

	if (value instanceof Date)
	{
		return {type: 'datetime', value: value};
	}

	if (typeof value === 'boolean')
	{
		return {type: 'int', value: (value) ? 1 : 0};
	}

	if (typeof value === 'number')
	{
		// A whole number that fits a 32-bit column goes as an integer; a
		// millisecond timestamp does not, so it goes as a double
		return (Math.floor(value) === value && Math.abs(value) <= 2147483647) ?
			{type: 'int', value: value} : {type: 'double', value: value};
	}

	return {type: 'varchar', value: '' + value};
};

// ---------------------------------------------- statements and parameters

/**
 * How long a statement a script may build, how many of them one Run may hold
 * prepared, and how many parameters one statement may carry. The main
 * process has its own limits; these are the friendly ones, so that a loop
 * appending to a statement for ever is stopped with words a script can act
 * on rather than by a rejected request.
 */
HmiSql.MAX_STATEMENT = 100000;
HmiSql.MAX_STATEMENTS = 32;
HmiSql.MAX_PARAMS = 200;

/**
 * How many parameters a statement wants: the ? marks in it, counting none of
 * those inside a string, a quoted or bracketed name or a comment. The main
 * process skips exactly the same places when it rewrites the marks for SQL
 * Server, so the two counts agree.
 */
HmiSql.countPlaceholders = function(sql)
{
	var text = '' + (sql == null ? '' : sql);
	var i = 0;
	var found = 0;

	while (i < text.length)
	{
		var c = text.charAt(i);

		if (c === "'" || c === '"')
		{
			var j = i + 1;

			while (j < text.length)
			{
				if (text.charAt(j) === c)
				{
					// A doubled quote is one inside the string
					if (text.charAt(j + 1) === c)
					{
						j += 2;

						continue;
					}

					break;
				}

				j++;
			}

			i = j + 1;
		}
		else if (c === '[')
		{
			var close = text.indexOf(']', i + 1);
			i = (close < 0) ? text.length : close + 1;
		}
		else if (c === '-' && text.charAt(i + 1) === '-')
		{
			var line = text.indexOf('\n', i);
			i = (line < 0) ? text.length : line;
		}
		else if (c === '/' && text.charAt(i + 1) === '*')
		{
			var end = text.indexOf('*/', i + 2);
			i = (end < 0) ? text.length : end + 2;
		}
		else
		{
			if (c === '?')
			{
				found++;
			}

			i++;
		}
	}

	return found;
};

/** A date and time as text, in the form both databases read back. */
HmiSql.dateText = function(d)
{
	var pad = function(n, w)
	{
		var text = '' + n;

		while (text.length < (w || 2))
		{
			text = '0' + text;
		}

		return text;
	};

	return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
		' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
		'.' + pad(d.getMilliseconds(), 3);
};

HmiSql.DATE_TEXT = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\.(\d{1,3}))?)?\s*$/;
HmiSql.TIME_TEXT = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\.(\d{1,3}))?\s*(am|pm|AM|PM)?\s*$/;

/**
 * A date and time from whatever a script has to hand: the millisecond number
 * a .TimeDate dotfield reads, or text.
 *
 * Text that looks like a date is read as plant-local time, field by field,
 * rather than handed to the browser: "2026-10-17" alone is read as UTC
 * midnight by the ISO rules, which in a plant west of Greenwich is the day
 * before. Anything else is left to the browser, which understands the forms
 * an operator types ("10/17/2026 2:05 PM").
 */
HmiSql.parseDateTime = function(value)
{
	if (value instanceof Date)
	{
		return isFinite(value.getTime()) ? value : null;
	}

	if (typeof value === 'number')
	{
		return isFinite(value) ? new Date(value) : null;
	}

	var text = ('' + (value == null ? '' : value)).trim();

	if (text === '')
	{
		return null;
	}

	var parts = HmiSql.DATE_TEXT.exec(text);

	if (parts != null)
	{
		var d = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]),
			Number(parts[4] || 0), Number(parts[5] || 0), Number(parts[6] || 0),
			Number(parts[7] || 0));

		return isFinite(d.getTime()) ? d : null;
	}

	var time = HmiSql.TIME_TEXT.exec(text);

	if (time != null)
	{
		// A time alone takes the date of the computer running it, which is
		// what a parameter set from an operator's entry wants
		var hour = Number(time[1]) % 24;
		var half = (time[5] || '').toLowerCase();

		if (half === 'pm' && hour < 12)
		{
			hour += 12;
		}
		else if (half === 'am' && hour === 12)
		{
			hour = 0;
		}

		var today = new Date();

		return new Date(today.getFullYear(), today.getMonth(), today.getDate(), hour,
			Number(time[2] || 0), Number(time[3] || 0), Number(time[4] || 0));
	}

	var loose = new Date(text);

	return isFinite(loose.getTime()) ? loose : null;
};

/**
 * Where a date and time can be cut short: the end of the year, the month, the
 * day, the hour, the minute, the second and the milliseconds in
 * "2026-10-17 14:05:09.270".
 */
HmiSql.DATE_FIELDS = [4, 7, 10, 13, 16, 19, 23];

/**
 * A date and time kept to a number of characters of its text form, which is
 * what a date-time parameter's precision asks for: 10 is the date alone, 16
 * to the minute, 19 to the second, 23 with the milliseconds. A length that
 * falls inside a field keeps the fields before it, so nothing is ever cut
 * through the middle of a number.
 */
HmiSql.datePrecision = function(d, precision)
{
	var want = Math.round(Number(precision));

	if (!isFinite(want) || want < 1 || want >= 23)
	{
		return d;
	}

	var keep = HmiSql.DATE_FIELDS[0];

	for (var i = 0; i < HmiSql.DATE_FIELDS.length; i++)
	{
		if (HmiSql.DATE_FIELDS[i] <= want)
		{
			keep = HmiSql.DATE_FIELDS[i];
		}
	}

	var full = HmiSql.dateText(d);
	var text = full.substring(0, keep) + '0001-01-01 00:00:00.000'.substring(keep);

	return HmiSql.parseDateTime(text) || d;
};

/**
 * What a decimal parameter is declared as. Scale matters: a driver that is
 * told nothing assumes none, and 123.456 reaches the column as 123. A
 * statement that says nothing gets the digits its own value has.
 */
HmiSql.decimalParam = function(value, precision, scale)
{
	var n = Number(value);
	var text = ('' + value).trim();
	var dot = text.indexOf('.');
	var own = (dot < 0) ? 0 : Math.min(text.length - dot - 1, 38);
	var s = Math.round(Number(scale));
	var p = Math.round(Number(precision));

	if (!isFinite(s) || s < 0 || s > 38)
	{
		s = own;
	}

	if (!isFinite(p) || p < 1 || p > 38)
	{
		p = Math.max(18, s);
	}

	return {type: 'decimal', value: n, precision: p, scale: Math.min(s, p)};
};

/**
 * The types a null parameter can be declared as, by the numbers the call
 * form uses: 0 text, 1 a date and time, 2 a whole number, 3 a floating point
 * number, 4 a decimal.
 */
HmiSql.NULL_PARAM_TYPES = ['varchar', 'datetime', 'int', 'double', 'decimal'];

/**
 * CREATE TABLE for a table template, then one CREATE INDEX per indexed
 * column, in the dialect of the database the connection is to.
 *
 * SQLite's types are affinities rather than constraints, and it has no date
 * type of its own: a date column is TEXT, which is the ISO 8601 convention
 * its own date functions use.
 */
HmiSql.tableSql = function(provider, table, template)
{
	var name = HmiSql.quoteColumn(table);
	var lines = [];
	var indexes = [];
	var columns = (template != null) ? (template.columns || []) : [];

	for (var i = 0; i < columns.length; i++)
	{
		var column = columns[i];

		if (!column.name)
		{
			continue;
		}

		lines.push(HmiSql.quoteColumn(column.name) + ' ' +
			HmiSql.columnSql(provider, column) +
			((column.allowNull === false) ? ' NOT NULL' : ''));

		if (column.index === 'unique' || column.index === 'nonunique')
		{
			// The index name carries the table's, because SQLite's index
			// names are unique across the whole database
			indexes.push('CREATE ' + ((column.index === 'unique') ? 'UNIQUE ' : '') +
				'INDEX ' + HmiSql.quoteColumn(table + '_' + column.name + '_idx') +
				' ON ' + name + ' (' + HmiSql.quoteColumn(column.name) + ')');
		}
	}

	return ['CREATE TABLE ' + name + ' (' + lines.join(', ') + ')'].concat(indexes);
};

HmiSql.columnSql = function(provider, column)
{
	var sqlite = (provider === 'sqlite');
	var length = parseInt(column.length, 10);
	var scale = parseInt(column.scale, 10);

	switch (HmiSql.normalizeType(column.type))
	{
		case 'integer':
			return (sqlite) ? 'INTEGER' : 'INT';
		case 'number':
			return (sqlite) ? 'REAL' : 'FLOAT';
		case 'decimal':
			return (sqlite) ? 'NUMERIC' : 'DECIMAL(' +
				(isFinite(length) && length > 0 ? length : 18) + ', ' +
				(isFinite(scale) && scale >= 0 ? scale : 2) + ')';
		case 'boolean':
			return (sqlite) ? 'INTEGER' : 'BIT';
		case 'date':
			return (sqlite) ? 'TEXT' : 'DATE';
		case 'time':
			return (sqlite) ? 'TEXT' : 'TIME';
		case 'datetime':
			return (sqlite) ? 'TEXT' : 'DATETIME';
	}

	return (sqlite) ? 'TEXT' : 'NVARCHAR(' +
		(isFinite(length) && length > 0 ? length : 255) + ')';
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
