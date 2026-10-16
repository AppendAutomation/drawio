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
