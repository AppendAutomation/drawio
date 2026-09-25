/**
 * Dialogs: tag dictionary, access names, runtime user input, validation
 * results and the runtime log.
 *
 * All are plain DOM shown through ui.showDialog, following the pattern of
 * upstream's own EditDataDialog rather than introducing a UI framework.
 */
HmiDialogs = function() {};

// ------------------------------------------------------------- utilities

HmiDialogs.el = function(tag, className, text)
{
	var node = document.createElement(tag);

	if (className != null)
	{
		node.className = className;
	}

	if (text != null)
	{
		mxUtils.write(node, text);
	}

	return node;
};

HmiDialogs.button = function(label, fn, primary)
{
	var btn = HmiDialogs.el('button', 'geBtn' + ((primary) ? ' gePrimaryBtn' : ''),
		label);

	mxEvent.addListener(btn, 'click', function(evt)
	{
		mxEvent.consume(evt);
		fn();
	});

	return btn;
};

HmiDialogs.field = function(parent, label, value, onChange, type)
{
	var row = HmiDialogs.el('div', 'hmiFormRow');
	row.appendChild(HmiDialogs.el('label', 'hmiFormLabel', label));

	var input = document.createElement('input');
	input.className = 'hmiInput';
	input.setAttribute('type', type || 'text');

	if (type === 'checkbox')
	{
		if (value)
		{
			input.setAttribute('checked', 'checked');
		}

		mxEvent.addListener(input, 'change', function()
		{
			onChange(input.checked);
		});
	}
	else
	{
		input.value = (value != null) ? value : '';

		var commit = function() { onChange(input.value); };
		mxEvent.addListener(input, 'blur', commit);
		mxEvent.addListener(input, 'keydown', function(evt)
		{
			if (evt.keyCode == 13) { commit(); }
		});
	}

	row.appendChild(input);
	parent.appendChild(row);

	return input;
};

HmiDialogs.select = function(parent, label, value, options, onChange)
{
	var row = HmiDialogs.el('div', 'hmiFormRow');
	row.appendChild(HmiDialogs.el('label', 'hmiFormLabel', label));

	var select = document.createElement('select');
	select.className = 'hmiInput';

	for (var i = 0; i < options.length; i++)
	{
		var opt = document.createElement('option');
		var v = (options[i].value != null) ? options[i].value : options[i];
		opt.setAttribute('value', v);
		mxUtils.write(opt, (options[i].label != null) ? options[i].label : v);

		if (v === value)
		{
			opt.setAttribute('selected', 'selected');
		}

		select.appendChild(opt);
	}

	mxEvent.addListener(select, 'change', function()
	{
		onChange(select.value);
	});

	row.appendChild(select);
	parent.appendChild(row);

	return select;
};

// ------------------------------------------------------- tag dictionary

HmiDialogs.showTagDictionary = function(ui)
{
	if (ui.hmiProject == null)
	{
		ui.hmiProject = HmiFile.createDefaultProject();
	}

	var dlg = new HmiTagDialog(ui);
	ui.showDialog(dlg.container, 820, 560, true, false);
	dlg.init();
};

HmiTagDialog = function(ui)
{
	this.ui = ui;
	this.project = ui.hmiProject;
	this.selected = null;

	var div = HmiDialogs.el('div', 'hmiDialog');

	div.appendChild(HmiDialogs.el('div', 'hmiDialogTitle',
		mxResources.get('hmiTagDictionary').replace('...', '')));

	var body = HmiDialogs.el('div', 'hmiDialogBody');

	// Left: the list plus its toolbar.
	var left = HmiDialogs.el('div', 'hmiTagListPane');

	this.filter = document.createElement('input');
	this.filter.className = 'hmiInput';
	this.filter.setAttribute('type', 'text');
	this.filter.setAttribute('placeholder', 'Filter');

	var that = this;
	mxEvent.addListener(this.filter, 'input', function() { that.renderList(); });
	left.appendChild(this.filter);

	this.listDiv = HmiDialogs.el('div', 'hmiTagList');
	left.appendChild(this.listDiv);

	var tools = HmiDialogs.el('div', 'hmiTagTools');

	var newSelect = document.createElement('select');
	newSelect.className = 'hmiInput';
	var first = document.createElement('option');
	first.setAttribute('value', '');
	mxUtils.write(first, 'New tag...');
	newSelect.appendChild(first);

	for (var i = 0; i < HmiTypes.TAG_TYPES.length; i++)
	{
		var opt = document.createElement('option');
		opt.setAttribute('value', HmiTypes.TAG_TYPES[i]);
		mxUtils.write(opt, HmiTypes.TAG_TYPES[i]);
		newSelect.appendChild(opt);
	}

	mxEvent.addListener(newSelect, 'change', function()
	{
		if (newSelect.value !== '')
		{
			that.createTag(newSelect.value);
			newSelect.value = '';
		}
	});

	tools.appendChild(newSelect);
	tools.appendChild(HmiDialogs.button('Duplicate', function() { that.duplicate(); }));
	tools.appendChild(HmiDialogs.button('Delete', function() { that.remove(); }));
	left.appendChild(tools);

	body.appendChild(left);

	// Right: the property form for the selected tag.
	this.formDiv = HmiDialogs.el('div', 'hmiTagForm');
	body.appendChild(this.formDiv);

	div.appendChild(body);

	var footer = HmiDialogs.el('div', 'hmiDialogFooter');
	footer.appendChild(HmiDialogs.button('Import CSV...', function() { that.importCsv(); }));
	footer.appendChild(HmiDialogs.button('Export CSV', function() { that.exportCsv(); }));

	var spacer = HmiDialogs.el('span', 'hmiSpacer');
	footer.appendChild(spacer);

	footer.appendChild(HmiDialogs.button(mxResources.get('close'), function()
	{
		ui.hideDialog();
	}, true));

	div.appendChild(footer);

	this.container = div;
};

HmiTagDialog.prototype.init = function()
{
	this.renderList();
	this.renderForm();
};

HmiTagDialog.prototype.visibleTags = function()
{
	var text = this.filter.value.toLowerCase();
	var res = [];

	for (var i = 0; i < this.project.tags.length; i++)
	{
		var tag = this.project.tags[i];

		if (text === '' || tag.name.toLowerCase().indexOf(text) >= 0 ||
			(tag.comment != null && tag.comment.toLowerCase().indexOf(text) >= 0))
		{
			res.push(tag);
		}
	}

	return res;
};

HmiTagDialog.prototype.renderList = function()
{
	var that = this;
	this.listDiv.innerText = '';

	var tags = this.visibleTags();

	if (tags.length === 0)
	{
		this.listDiv.appendChild(
			HmiDialogs.el('div', 'hmiEmpty', 'No tags defined.'));

		return;
	}

	for (var i = 0; i < tags.length; i++)
	{
		this.listDiv.appendChild(this.createRow(tags[i]));
	}
};

HmiTagDialog.prototype.createRow = function(tag)
{
	var that = this;
	var row = HmiDialogs.el('div', 'hmiTagRow' +
		((this.selected === tag) ? ' hmiTagRowOn' : ''));

	row.appendChild(HmiDialogs.el('span', 'hmiTagName', tag.name));
	row.appendChild(HmiDialogs.el('span', 'hmiTagType', tag.type));

	mxEvent.addListener(row, 'click', function()
	{
		that.selected = tag;
		that.renderList();
		that.renderForm();
	});

	return row;
};

HmiTagDialog.prototype.renderForm = function()
{
	var that = this;
	var tag = this.selected;
	this.formDiv.innerText = '';

	if (tag == null)
	{
		this.formDiv.appendChild(
			HmiDialogs.el('div', 'hmiEmpty', 'Select a tag, or create one.'));

		return;
	}

	// Renaming is a first-class operation, not an edit to a text field:
	// every expression referencing the old name has to move with it.
	var nameInput = HmiDialogs.field(this.formDiv, 'Name', tag.name,
		function(value)
		{
			that.rename(tag, value);
		});

	HmiDialogs.select(this.formDiv, 'Type', tag.type, HmiTypes.TAG_TYPES,
		function(value)
		{
			tag.type = value;
			that.renderList();
			that.renderForm();
		});

	HmiDialogs.field(this.formDiv, 'Comment', tag.comment,
		function(v) { tag.comment = v; });

	if (HmiTypes.isAnalog(tag.type))
	{
		HmiDialogs.field(this.formDiv, 'Engineering units', tag.engUnits,
			function(v) { tag.engUnits = v; });
		HmiDialogs.field(this.formDiv, 'Initial value', tag.initial,
			function(v) { tag.initial = parseFloat(v) || 0; });
		HmiDialogs.field(this.formDiv, 'Minimum EU', tag.minEU,
			function(v) { tag.minEU = parseFloat(v) || 0; });
		HmiDialogs.field(this.formDiv, 'Maximum EU', tag.maxEU,
			function(v) { tag.maxEU = parseFloat(v) || 0; });
	}
	else if (HmiTypes.isDiscrete(tag.type))
	{
		HmiDialogs.field(this.formDiv, 'Initial value', tag.initial,
			function(v) { tag.initial = (v === '1' || v === 'true') ? 1 : 0; });
		HmiDialogs.field(this.formDiv, 'On message', tag.onMsg,
			function(v) { tag.onMsg = v; });
		HmiDialogs.field(this.formDiv, 'Off message', tag.offMsg,
			function(v) { tag.offMsg = v; });
	}
	else
	{
		HmiDialogs.field(this.formDiv, 'Initial value', tag.initial,
			function(v) { tag.initial = v; });
	}

	if (HmiTypes.isIO(tag.type))
	{
		this.formDiv.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'I/O'));

		var names = [''];

		for (var i = 0; i < this.project.accessNames.length; i++)
		{
			names.push(this.project.accessNames[i].id);
		}

		HmiDialogs.select(this.formDiv, 'Access name', tag.access, names,
			function(v) { tag.access = v; });
		HmiDialogs.field(this.formDiv, 'Item name', tag.item,
			function(v) { tag.item = v; });

		if (HmiTypes.isAnalog(tag.type))
		{
			HmiDialogs.field(this.formDiv, 'Minimum raw', tag.minRaw,
				function(v) { tag.minRaw = parseFloat(v) || 0; });
			HmiDialogs.field(this.formDiv, 'Maximum raw', tag.maxRaw,
				function(v) { tag.maxRaw = parseFloat(v) || 0; });
		}
	}

	if (HmiTypes.isAnalog(tag.type))
	{
		this.formDiv.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Alarms'));

		if (tag.alarms == null)
		{
			tag.alarms = {};
		}

		var limits = [['loLo', 'LoLo'], ['low', 'Low'], ['high', 'High'],
			['hiHi', 'HiHi'], ['deadband', 'Deadband']];

		for (var i = 0; i < limits.length; i++)
		{
			(function(key)
			{
				HmiDialogs.field(that.formDiv, limits[i][1], tag.alarms[key],
					function(v)
					{
						if (v === '') { delete tag.alarms[key]; }
						else { tag.alarms[key] = parseFloat(v); }
					});
			})(limits[i][0]);
		}
	}

	this.formDiv.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Simulation'));

	if (tag.sim == null)
	{
		tag.sim = {};
	}

	HmiDialogs.select(this.formDiv, 'Mode', tag.sim.mode || '',
		['', 'sine', 'ramp', 'random', 'toggle', 'static'],
		function(v)
		{
			if (v === '') { delete tag.sim.mode; }
			else { tag.sim.mode = v; }
		});

	HmiDialogs.field(this.formDiv, 'Period (ms)', tag.sim.periodMs,
		function(v)
		{
			if (v === '') { delete tag.sim.periodMs; }
			else { tag.sim.periodMs = v; }
		});
};

HmiTagDialog.prototype.uniqueName = function(base)
{
	var name = base;
	var n = 1;

	while (this.project.getTag(name) != null)
	{
		name = base + '_' + (++n);
	}

	return name;
};

HmiTagDialog.prototype.createTag = function(type)
{
	var tag = HmiProject.createTag(this.uniqueName('NewTag'), type);
	this.project.addTag(tag);
	this.selected = tag;
	this.markModified();
	this.renderList();
	this.renderForm();
};

HmiTagDialog.prototype.duplicate = function()
{
	if (this.selected == null)
	{
		return;
	}

	var copy = JSON.parse(JSON.stringify(this.selected));
	copy.name = this.uniqueName(this.selected.name);
	this.project.addTag(copy);
	this.selected = copy;
	this.markModified();
	this.renderList();
	this.renderForm();
};

HmiTagDialog.prototype.remove = function()
{
	if (this.selected == null)
	{
		return;
	}

	var refs = HmiTagDialog.findReferences(this.ui, this.selected.name);
	var name = this.selected.name;

	var proceed = mxUtils.bind(this, function()
	{
		this.project.removeTag(name);
		this.selected = null;
		this.markModified();
		this.renderList();
		this.renderForm();
	});

	if (refs.length > 0)
	{
		this.ui.confirm('"' + name + '" is used by ' + refs.length +
			' animation link' + ((refs.length == 1) ? '' : 's') +
			'. Delete it anyway?', proceed);
	}
	else
	{
		proceed();
	}
};

/**
 * Renames a tag and rewrites every expression that references it.
 *
 * Without this a rename silently breaks every animation using the tag, which
 * makes the tool feel broken long before anyone works out why.
 */
HmiTagDialog.prototype.rename = function(tag, next)
{
	next = ('' + next).trim();

	if (next === '' || next === tag.name)
	{
		return;
	}

	if (!/^[A-Za-z_$][A-Za-z0-9_$]{0,62}$/.test(next))
	{
		this.ui.showError(mxResources.get('error'),
			'Tag names start with a letter, _ or $ and may contain letters, ' +
			'digits, _ and $ (max 63 characters).', mxResources.get('ok'));
		this.renderForm();

		return;
	}

	if (this.project.getTag(next) != null)
	{
		this.ui.showError(mxResources.get('error'),
			'A tag named "' + next + '" already exists.',
			mxResources.get('ok'));
		this.renderForm();

		return;
	}

	var previous = tag.name;
	var count = HmiTagDialog.rewriteReferences(this.ui, previous, next);

	delete this.project.tagIndex[previous.toLowerCase()];
	tag.name = next;
	this.project.tagIndex[next.toLowerCase()] = tag;

	this.markModified();
	this.renderList();
	this.renderForm();

	if (count > 0)
	{
		HmiLog.log('renamed ' + previous + ' to ' + next + ', updated ' +
			count + ' reference' + ((count == 1) ? '' : 's'));
	}
};

/** Every link config field that can name a tag. */
HmiTagDialog.REFERENCE_FIELDS = ['expr', 'tag', 'enableExpr', 'min', 'max',
	'rateMs'];

HmiTagDialog.eachReference = function(ui, fn)
{
	var graph = ui.editor.graph;
	var model = graph.getModel();

	var walk = function(parent)
	{
		var count = model.getChildCount(parent);

		for (var i = 0; i < count; i++)
		{
			var cell = model.getChildAt(parent, i);
			var links = HmiProject.getCellLinks(graph, cell);
			var touched = false;

			for (var key in links)
			{
				var cfg = links[key];

				for (var f = 0; f < HmiTagDialog.REFERENCE_FIELDS.length; f++)
				{
					var field = HmiTagDialog.REFERENCE_FIELDS[f];

					if (fn(cfg, field, cell, key))
					{
						touched = true;
					}
				}

				if (cfg.bands != null)
				{
					for (var b = 0; b < cfg.bands.length; b++)
					{
						if (fn(cfg.bands[b], 'max', cell, key))
						{
							touched = true;
						}
					}
				}
			}

			if (touched)
			{
				HmiProject.setCellLinks(graph, cell, links);
			}

			walk(cell);
		}
	};

	walk(graph.getDefaultParent());
};

HmiTagDialog.findReferences = function(ui, name)
{
	var found = [];
	var target = name.toLowerCase();

	HmiTagDialog.eachReference(ui, function(holder, field, cell, key)
	{
		var src = holder[field];

		if (src != null && src !== '' &&
			HmiTagDialog.referencesTag(src, target))
		{
			found.push({cell: cell, link: key, field: field});
		}

		return false;
	});

	return found;
};

HmiTagDialog.referencesTag = function(src, lowerName)
{
	var re = new RegExp('(^|[^A-Za-z0-9_$.])' +
		HmiTagDialog.escapeRe(lowerName) + '(?![A-Za-z0-9_$])', 'i');

	return re.test(' ' + src);
};

HmiTagDialog.escapeRe = function(text)
{
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

HmiTagDialog.rewriteReferences = function(ui, from, to)
{
	var count = 0;

	// Word boundary that also refuses a preceding dot, so Other.Tank_Level
	// (a dotfield on a different tag) is never rewritten.
	var re = new RegExp('(^|[^A-Za-z0-9_$.])(' +
		HmiTagDialog.escapeRe(from) + ')(?![A-Za-z0-9_$])', 'gi');

	HmiTagDialog.eachReference(ui, function(holder, field)
	{
		var src = holder[field];

		if (src == null || src === '' || typeof src !== 'string')
		{
			return false;
		}

		var next = src.replace(re, function(match, prefix)
		{
			count++;

			return prefix + to;
		});

		if (next !== src)
		{
			holder[field] = next;

			return true;
		}

		return false;
	});

	return count;
};

HmiTagDialog.prototype.markModified = function()
{
	this.ui.editor.setModified(true);
};

// --------------------------------------------------------------- CSV

/**
 * A flat CSV of the scalar fields, which is what an engineer actually wants
 * for bulk edits in a spreadsheet.
 */
HmiTagDialog.CSV_FIELDS = ['name', 'type', 'comment', 'engUnits', 'initial',
	'minEU', 'maxEU', 'minRaw', 'maxRaw', 'access', 'item', 'onMsg', 'offMsg'];

HmiTagDialog.prototype.exportCsv = function()
{
	var rows = [HmiTagDialog.CSV_FIELDS.join(',')];

	for (var i = 0; i < this.project.tags.length; i++)
	{
		var tag = this.project.tags[i];
		var cells = [];

		for (var f = 0; f < HmiTagDialog.CSV_FIELDS.length; f++)
		{
			cells.push(HmiTagDialog.csvCell(tag[HmiTagDialog.CSV_FIELDS[f]]));
		}

		rows.push(cells.join(','));
	}

	var text = rows.join('\n');

	this.ui.showDialog(new HmiTextDialog(this.ui, 'Export CSV', text,
		'Copy this into a spreadsheet.').container, 620, 420, true, true);
};

HmiTagDialog.csvCell = function(value)
{
	if (value == null)
	{
		return '';
	}

	var text = '' + value;

	return (/[",\n]/.test(text)) ? '"' + text.replace(/"/g, '""') + '"' : text;
};

HmiTagDialog.prototype.importCsv = function()
{
	var that = this;

	var dlg = new HmiTextDialog(this.ui, 'Import CSV', '',
		'Paste rows with a header line naming the columns.',
		function(text)
		{
			var added = that.applyCsv(text);
			that.ui.hideDialog();
			that.renderList();
			that.renderForm();
			HmiLog.log('imported ' + added + ' tags');
		});

	this.ui.showDialog(dlg.container, 620, 420, true, true);
};

HmiTagDialog.prototype.applyCsv = function(text)
{
	var lines = text.split(/\r?\n/);
	var header = null;
	var added = 0;

	for (var i = 0; i < lines.length; i++)
	{
		if (lines[i].trim() === '')
		{
			continue;
		}

		var cells = HmiTagDialog.parseCsvLine(lines[i]);

		if (header == null)
		{
			header = cells;
			continue;
		}

		var record = {};

		for (var c = 0; c < header.length && c < cells.length; c++)
		{
			record[header[c].trim()] = cells[c];
		}

		if (record.name == null || record.name === '')
		{
			continue;
		}

		var type = record.type || 'MemoryReal';
		var tag = this.project.getTag(record.name);

		if (tag == null)
		{
			tag = HmiProject.createTag(record.name, type);
			this.project.addTag(tag);
			added++;
		}

		tag.type = type;

		for (var f = 0; f < HmiTagDialog.CSV_FIELDS.length; f++)
		{
			var field = HmiTagDialog.CSV_FIELDS[f];

			if (field === 'name' || field === 'type' ||
				record[field] == null || record[field] === '')
			{
				continue;
			}

			var numeric = (field === 'minEU' || field === 'maxEU' ||
				field === 'minRaw' || field === 'maxRaw' ||
				(field === 'initial' && !HmiTypes.isMessage(type)));

			tag[field] = (numeric) ? parseFloat(record[field]) : record[field];
		}
	}

	this.project.reindex();
	this.markModified();

	return added;
};

HmiTagDialog.parseCsvLine = function(line)
{
	var cells = [];
	var cur = '';
	var quoted = false;

	for (var i = 0; i < line.length; i++)
	{
		var ch = line.charAt(i);

		if (quoted)
		{
			if (ch === '"')
			{
				if (line.charAt(i + 1) === '"') { cur += '"'; i++; }
				else { quoted = false; }
			}
			else { cur += ch; }
		}
		else if (ch === '"') { quoted = true; }
		else if (ch === ',') { cells.push(cur); cur = ''; }
		else { cur += ch; }
	}

	cells.push(cur);

	return cells;
};

// ------------------------------------------------------- generic dialogs

HmiTextDialog = function(ui, title, text, hint, onAccept)
{
	var div = HmiDialogs.el('div', 'hmiDialog');
	div.appendChild(HmiDialogs.el('div', 'hmiDialogTitle', title));

	if (hint != null)
	{
		div.appendChild(HmiDialogs.el('div', 'hmiHint', hint));
	}

	var area = document.createElement('textarea');
	area.className = 'hmiTextArea';
	area.value = text || '';
	div.appendChild(area);

	var footer = HmiDialogs.el('div', 'hmiDialogFooter');
	footer.appendChild(HmiDialogs.el('span', 'hmiSpacer'));

	footer.appendChild(HmiDialogs.button(mxResources.get('close'), function()
	{
		ui.hideDialog();
	}));

	if (onAccept != null)
	{
		footer.appendChild(HmiDialogs.button(mxResources.get('ok'), function()
		{
			onAccept(area.value);
		}, true));
	}

	div.appendChild(footer);
	this.container = div;

	window.setTimeout(function() { area.focus(); area.select(); }, 0);
};

// -------------------------------------------------------- access names

HmiDialogs.showAccessNames = function(ui)
{
	if (ui.hmiProject == null)
	{
		ui.hmiProject = HmiFile.createDefaultProject();
	}

	var project = ui.hmiProject;
	var div = HmiDialogs.el('div', 'hmiDialog');
	div.appendChild(HmiDialogs.el('div', 'hmiDialogTitle', 'Access Names'));

	var body = HmiDialogs.el('div', 'hmiDialogBody hmiDialogBodyPlain');

	var render = function()
	{
		body.innerText = '';

		for (var i = 0; i < project.accessNames.length; i++)
		{
			(function(a)
			{
				var box = HmiDialogs.el('div', 'hmiFormBox');
				HmiDialogs.field(box, 'Name', a.id, function(v) { a.id = v; });
				HmiDialogs.select(box, 'Driver', a.driver,
					['simulator', 'ethernetip'], function(v) { a.driver = v; });
				HmiDialogs.field(box, 'Node (host or IP)', a.node,
					function(v) { a.node = v; });
				HmiDialogs.field(box, 'Topic / slot', a.topic,
					function(v) { a.topic = v; });
				HmiDialogs.field(box, 'Scan rate (ms)', a.rateMs,
					function(v) { a.rateMs = parseInt(v, 10) || 250; });
				body.appendChild(box);
			})(project.accessNames[i]);
		}

		if (project.accessNames.length === 0)
		{
			body.appendChild(HmiDialogs.el('div', 'hmiEmpty',
				'No access names defined.'));
		}
	};

	render();
	div.appendChild(body);

	var footer = HmiDialogs.el('div', 'hmiDialogFooter');

	footer.appendChild(HmiDialogs.button('Add', function()
	{
		project.accessNames.push({id: 'PLC' + (project.accessNames.length + 1),
			driver: 'simulator', node: '', topic: '', rateMs: 250});
		render();
	}));

	footer.appendChild(HmiDialogs.el('span', 'hmiSpacer'));
	footer.appendChild(HmiDialogs.button(mxResources.get('close'), function()
	{
		ui.hideDialog();
	}, true));

	div.appendChild(footer);
	ui.showDialog(div, 520, 460, true, true);
};

// -------------------------------------------------- application settings

/**
 * The target device's screen and the windows that open when the application
 * starts. Changes are made to a copy and applied on OK, so Cancel means it.
 */
HmiDialogs.showAppSettings = function(ui)
{
	if (ui.hmiProject == null)
	{
		ui.hmiProject = HmiFile.createDefaultProject();
	}

	var project = ui.hmiProject;
	var pages = ui.pages || [];
	var width = project.settings.width;
	var height = project.settings.height;
	var startup = {};

	for (var i = 0; i < project.settings.startup.length; i++)
	{
		startup[project.settings.startup[i]] = true;
	}

	var div = HmiDialogs.el('div', 'hmiDialog');
	div.appendChild(HmiDialogs.el('div', 'hmiDialogTitle',
		mxResources.get('hmiAppSettings')));

	var body = HmiDialogs.el('div', 'hmiDialogBody hmiDialogBodyPlain');
	body.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Target screen'));

	var options = [];

	for (var i = 0; i < HmiProject.RESOLUTIONS.length; i++)
	{
		var r = HmiProject.RESOLUTIONS[i];
		options.push({value: r[0] + 'x' + r[1], label: r[0] + ' × ' + r[1]});
	}

	options.push({value: 'custom', label: 'Custom'});

	var presetOf = function()
	{
		for (var i = 0; i < HmiProject.RESOLUTIONS.length; i++)
		{
			var r = HmiProject.RESOLUTIONS[i];

			if (r[0] === width && r[1] === height)
			{
				return r[0] + 'x' + r[1];
			}
		}

		return 'custom';
	};

	var preset = HmiDialogs.select(body, 'Resolution', presetOf(), options,
		function(v)
		{
			if (v !== 'custom')
			{
				var wh = v.split('x');
				width = parseInt(wh[0], 10);
				height = parseInt(wh[1], 10);
				wInput.value = width;
				hInput.value = height;
			}
		});

	var dimension = function(v)
	{
		var n = parseInt(v, 10);

		return (!isNaN(n) && n >= 100 && n <= 10000) ? n : null;
	};

	var wInput = HmiDialogs.field(body, 'Width (px)', width, function() {},
		'number');
	var hInput = HmiDialogs.field(body, 'Height (px)', height, function() {},
		'number');

	var sync = function()
	{
		var w = dimension(wInput.value);
		var h = dimension(hInput.value);

		if (w != null) { width = w; }
		if (h != null) { height = h; }

		preset.value = presetOf();
	};

	mxEvent.addListener(wInput, 'input', sync);
	mxEvent.addListener(hInput, 'input', sync);

	body.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Startup windows'));
	body.appendChild(HmiDialogs.el('div', 'hmiHint',
		'Opened in page order when the application starts, each on top of ' +
		'the last. A replace window closes any earlier one it overlaps. With ' +
		'none ticked, the page being edited opens.'));

	var list = HmiDialogs.el('div', 'hmiFormBox hmiStartupList');

	for (var i = 0; i < pages.length; i++)
	{
		(function(page)
		{
			var id = page.getId();
			var w = project.getWindow(id);
			var row = HmiDialogs.el('label', 'hmiStartupRow');
			var box = document.createElement('input');
			box.setAttribute('type', 'checkbox');
			box.setAttribute('data-hmi-page', id);

			if (startup[id])
			{
				box.setAttribute('checked', 'checked');
			}

			mxEvent.addListener(box, 'change', function()
			{
				startup[id] = box.checked;
			});

			row.appendChild(box);
			row.appendChild(HmiDialogs.el('span', 'hmiStartupName',
				page.getName()));
			row.appendChild(HmiDialogs.el('span', 'hmiStartupInfo',
				HmiDialogs.windowSummary(w)));
			list.appendChild(row);
		})(pages[i]);
	}

	if (pages.length === 0)
	{
		list.appendChild(HmiDialogs.el('div', 'hmiEmpty', 'No pages.'));
	}

	body.appendChild(list);

	var error = HmiDialogs.el('div', 'hmiError');
	body.appendChild(error);
	div.appendChild(body);

	var apply = function()
	{
		var w = dimension(wInput.value);
		var h = dimension(hInput.value);

		if (w == null || h == null)
		{
			error.innerText = 'Width and height must be whole numbers from ' +
				'100 to 10000.';

			return false;
		}

		var ids = [];

		for (var i = 0; i < pages.length; i++)
		{
			if (startup[pages[i].getId()])
			{
				ids.push(pages[i].getId());
			}
		}

		var s = project.settings;
		var changed = s.width !== w || s.height !== h ||
			s.startup.join('\n') !== ids.join('\n');

		// Windows left at full-screen size follow the new resolution, since
		// an unset size means "the screen".
		s.width = w;
		s.height = h;
		s.startup = ids;

		if (changed)
		{
			project.touch();
			ui.editor.setModified(true);
		}

		return true;
	};

	HmiDialogs.okCancel(ui, div, apply);
	ui.showDialog(div, 460, 480, true, true);
};

/** "Popup, title bar, 400 × 300 at 10, 20" */
HmiDialogs.windowSummary = function(w)
{
	var type = {replace: 'Replace', overlay: 'Overlay', popup: 'Popup'}[w.type];

	return type + ((w.titleBar) ? ', title bar' : '') + ', ' +
		w.width + ' × ' + w.height + ' at ' + w.x + ', ' + w.y;
};

/** Cancel and OK. OK closes only when apply() returns true. */
HmiDialogs.okCancel = function(ui, div, apply)
{
	var footer = HmiDialogs.el('div', 'hmiDialogFooter');
	footer.appendChild(HmiDialogs.el('span', 'hmiSpacer'));
	footer.appendChild(HmiDialogs.button(mxResources.get('cancel'), function()
	{
		ui.hideDialog();
	}));

	var ok = HmiDialogs.button(mxResources.get('ok'), function()
	{
		if (apply())
		{
			ui.hideDialog();
		}
	}, true);

	ok.className += ' hmiOk';
	footer.appendChild(ok);
	div.appendChild(footer);
};

// ------------------------------------------------------ window properties

/**
 * How a window (page) is displayed when it opens at run time. The window
 * picker switches between pages without losing edits: every page edited is
 * kept as a draft and all of them are applied on OK.
 */
HmiDialogs.showWindowProps = function(ui, page)
{
	if (ui.hmiProject == null)
	{
		ui.hmiProject = HmiFile.createDefaultProject();
	}

	var project = ui.hmiProject;
	var pages = ui.pages || [];

	if (page == null)
	{
		page = ui.currentPage;
	}

	if (page == null)
	{
		return;
	}

	var drafts = {};
	var current = page;

	var draftFor = function(p)
	{
		var id = p.getId();

		if (drafts[id] == null)
		{
			drafts[id] = project.getWindow(id);
		}

		return drafts[id];
	};

	var div = HmiDialogs.el('div', 'hmiDialog');
	div.appendChild(HmiDialogs.el('div', 'hmiDialogTitle',
		mxResources.get('hmiWindowProps')));

	var body = HmiDialogs.el('div', 'hmiDialogBody hmiDialogBodyPlain');
	var fields = HmiDialogs.el('div');
	var error = HmiDialogs.el('div', 'hmiError');

	var options = [];

	for (var i = 0; i < pages.length; i++)
	{
		options.push({value: pages[i].getId(), label: pages[i].getName()});
	}

	if (options.length > 1)
	{
		HmiDialogs.select(body, 'Window', page.getId(), options, function(v)
		{
			for (var i = 0; i < pages.length; i++)
			{
				if (pages[i].getId() === v)
				{
					current = pages[i];
					render();
				}
			}
		});
	}
	else
	{
		body.appendChild(HmiDialogs.el('div', 'hmiHint', page.getName()));
	}

	body.appendChild(fields);
	body.appendChild(error);
	div.appendChild(body);

	var render = function()
	{
		fields.innerText = '';
		error.innerText = '';

		var d = draftFor(current);
		var res = project.settings;

		fields.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Appearance'));

		var tb = HmiDialogs.field(fields, 'Title bar', d.titleBar, function(v)
		{
			d.titleBar = v;
			update();
		}, 'checkbox');
		tb.setAttribute('data-hmi-prop', 'titleBar');

		fields.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Type'));

		var types = [
			{value: 'replace', label: 'Replace',
				hint: 'Closes any window it overlaps when it opens.'},
			{value: 'overlay', label: 'Overlay',
				hint: 'Opens on top of other windows and leaves them open.'},
			{value: 'popup', label: 'Popup (modal)',
				hint: 'Stays on top of every other window, and nothing ' +
					'beneath it can be touched until it closes.'}];

		var group = 'hmiWinType' + (++HmiDialogs.radioCounter);

		for (var i = 0; i < types.length; i++)
		{
			(function(t)
			{
				var row = HmiDialogs.el('label', 'hmiRadioRow');
				var radio = document.createElement('input');
				radio.setAttribute('type', 'radio');
				radio.setAttribute('name', group);
				radio.setAttribute('value', t.value);

				if (d.type === t.value)
				{
					radio.setAttribute('checked', 'checked');
				}

				mxEvent.addListener(radio, 'change', function()
				{
					if (radio.checked)
					{
						d.type = t.value;
					}
				});

				row.appendChild(radio);

				var text = HmiDialogs.el('span', 'hmiRadioText');
				text.appendChild(HmiDialogs.el('span', 'hmiRadioLabel', t.label));
				text.appendChild(HmiDialogs.el('span', 'hmiRadioHint', t.hint));
				row.appendChild(text);
				fields.appendChild(row);
			})(types[i]);
		}

		fields.appendChild(HmiDialogs.el('div', 'hmiFormSection',
			'Position and size (screen is ' + res.width + ' × ' +
			res.height + ')'));

		var inputs = {};
		var dims = [['x', 'Left (px)'], ['y', 'Top (px)'],
			['width', 'Width (px)'], ['height', 'Height (px)']];

		for (var i = 0; i < dims.length; i++)
		{
			(function(key, label)
			{
				var input = HmiDialogs.field(fields, label, d[key], function() {},
					'number');
				input.setAttribute('data-hmi-prop', key);
				inputs[key] = input;

				mxEvent.addListener(input, 'input', function()
				{
					var n = parseInt(input.value, 10);

					if (!isNaN(n))
					{
						d[key] = n;
					}

					update();
				});
			})(dims[i][0], dims[i][1]);
		}

		var row = HmiDialogs.el('div', 'hmiFormRow hmiWindowButtons');
		row.appendChild(HmiDialogs.el('span', 'hmiFormLabel'));

		row.appendChild(HmiDialogs.button('Full Screen', function()
		{
			d.x = 0;
			d.y = 0;
			d.width = res.width;
			d.height = res.height;
			refill();
		}));

		row.appendChild(HmiDialogs.button('Fit to Content', function()
		{
			var size = HmiDialogs.pageContentSize(ui, current);

			if (size != null)
			{
				d.width = size.width;
				d.height = size.height + ((d.titleBar) ?
					HmiProject.TITLE_BAR_HEIGHT : 0);
				refill();
			}
		}));

		row.appendChild(HmiDialogs.button('Center', function()
		{
			d.x = Math.max(0, Math.round((res.width - d.width) / 2));
			d.y = Math.max(0, Math.round((res.height - d.height) / 2));
			refill();
		}));

		fields.appendChild(row);

		var preview = HmiDialogs.el('div', 'hmiScreenPreview');
		var rect = HmiDialogs.el('div', 'hmiScreenPreviewWindow');
		preview.appendChild(rect);
		fields.appendChild(preview);

		var refill = function()
		{
			for (var k in inputs)
			{
				inputs[k].value = d[k];
			}

			update();
		};

		var update = function()
		{
			var pw = 240;
			var scale = pw / res.width;
			preview.style.width = pw + 'px';
			preview.style.height = Math.round(res.height * scale) + 'px';
			rect.style.left = Math.round(d.x * scale) + 'px';
			rect.style.top = Math.round(d.y * scale) + 'px';
			rect.style.width = Math.max(1, Math.round(d.width * scale)) + 'px';
			rect.style.height = Math.max(1, Math.round(d.height * scale)) + 'px';
			rect.style.borderTopWidth = (d.titleBar) ?
				Math.max(2, Math.round(HmiProject.TITLE_BAR_HEIGHT * scale)) +
				'px' : '1px';

			var msg = HmiMenus.checkWindow({settings: res,
				getWindow: function() { return d; }}, current.getId());
			error.innerText = (msg != null) ? msg + '.' : '';
		};

		update();
	};

	render();

	var apply = function()
	{
		for (var id in drafts)
		{
			if (!(drafts[id].width > 0 && drafts[id].height > 0))
			{
				error.innerText = 'Width and height must be greater than zero.';

				return false;
			}
		}

		var changed = false;

		for (var id in drafts)
		{
			var before = JSON.stringify(project.windows[id] || {});
			project.setWindow(id, drafts[id]);

			if (JSON.stringify(project.windows[id] || {}) !== before)
			{
				changed = true;
			}
		}

		if (changed)
		{
			project.touch();
			ui.editor.setModified(true);
		}

		return true;
	};

	HmiDialogs.okCancel(ui, div, apply);
	ui.showDialog(div, 460, 720, true, true);
};

HmiDialogs.radioCounter = 0;

/**
 * The size a window needs to show all of a page's content, measured from the
 * page origin, since the window's top-left is the page's origin.
 */
HmiDialogs.pageContentSize = function(ui, page)
{
	var model = HmiWindowManager.modelForPage(ui, page);
	var graph = new Graph(document.createElement('div'), model);
	var cells = [];
	var root = model.getRoot();

	for (var i = 0; i < model.getChildCount(root); i++)
	{
		var layer = model.getChildAt(root, i);

		for (var j = 0; j < model.getChildCount(layer); j++)
		{
			cells.push(model.getChildAt(layer, j));
		}
	}

	var bounds = (cells.length > 0) ?
		graph.getBoundingBoxFromGeometry(cells, true) : null;
	graph.destroy();

	if (bounds == null)
	{
		return null;
	}

	return {width: Math.ceil(Math.max(0, bounds.x) + bounds.width),
		height: Math.ceil(Math.max(0, bounds.y) + bounds.height)};
};

// ---------------------------------------------------------- user input

/**
 * Runtime value entry. Validates against the link's min/max, which are
 * themselves expressions, so the limits can track engineering ranges.
 */
HmiDialogs.showUserInput = function(ui, cfg, runtime)
{
	var rt = (runtime != null) ? runtime : ui.hmiRuntime;

	if (rt == null)
	{
		return;
	}

	var current = rt.getValue(cfg.tag);
	var div = HmiDialogs.el('div', 'hmiDialog');
	div.appendChild(HmiDialogs.el('div', 'hmiDialogTitle',
		cfg.prompt || 'Enter value'));

	var body = HmiDialogs.el('div', 'hmiDialogBody hmiDialogBodyPlain');
	body.appendChild(HmiDialogs.el('div', 'hmiHint', cfg.tag));

	var input = null;
	var error = HmiDialogs.el('div', 'hmiError');

	if (cfg.kind === 'discrete')
	{
		var row = HmiDialogs.el('div', 'hmiFormRow');
		var on = HmiDialogs.button('On', function() { accept(1); });
		var off = HmiDialogs.button('Off', function() { accept(0); });
		row.appendChild(on);
		row.appendChild(off);
		body.appendChild(row);
	}
	else
	{
		input = HmiDialogs.field(body, 'Value',
			(current.value != null) ? current.value : '', function() {});

		// Show the limits rather than only enforcing them: being told a value
		// is out of range after typing it is a poor substitute for knowing the
		// range beforehand.
		if (cfg.kind === 'analog')
		{
			var range = HmiDialogs.rangeText(rt, cfg);

			if (range != null)
			{
				body.appendChild(HmiDialogs.el('div', 'hmiRange', range));
			}
		}

		// The on-screen input is for a touch screen with no keyboard, which is
		// the whole reason the option exists.
		if (cfg.keypad)
		{
			body.appendChild((cfg.kind === 'analog') ?
				HmiDialogs.keypad(input) : HmiDialogs.keyboard(input));
		}
	}

	body.appendChild(error);
	div.appendChild(body);

	function accept(value)
	{
		if (cfg.kind === 'analog')
		{
			var n = parseFloat(value);

			if (isNaN(n))
			{
				error.innerText = 'Enter a number.';

				return;
			}

			var lo = (cfg.min != null && cfg.min !== '') ?
				parseFloat(rt.evaluate(cfg.min).value) : NaN;
			var hi = (cfg.max != null && cfg.max !== '') ?
				parseFloat(rt.evaluate(cfg.max).value) : NaN;

			if (!isNaN(lo) && n < lo)
			{
				error.innerText = 'Minimum is ' + lo + '.';

				return;
			}

			if (!isNaN(hi) && n > hi)
			{
				error.innerText = 'Maximum is ' + hi + '.';

				return;
			}

			value = n;
		}

		var writes = {};
		writes[cfg.tag] = value;
		var res = rt.driver.write(writes);

		if (res[cfg.tag] != null && !res[cfg.tag].ok)
		{
			error.innerText = res[cfg.tag].error;

			return;
		}

		ui.hideDialog();
	}

	var footer = HmiDialogs.el('div', 'hmiDialogFooter');
	footer.appendChild(HmiDialogs.el('span', 'hmiSpacer'));
	footer.appendChild(HmiDialogs.button(mxResources.get('cancel'), function()
	{
		ui.hideDialog();
	}));

	if (cfg.kind !== 'discrete')
	{
		footer.appendChild(HmiDialogs.button(mxResources.get('ok'), function()
		{
			accept(input.value);
		}, true));
	}

	div.appendChild(footer);

	var height = 260;

	if (cfg.keypad && cfg.kind === 'analog') { height = 500; }
	else if (cfg.keypad && cfg.kind !== 'discrete') { height = 420; }

	ui.showDialog(div, (cfg.keypad && cfg.kind === 'string') ? 560 : 380,
		height, true, true);

	if (input != null)
	{
		window.setTimeout(function() { input.focus(); input.select(); }, 0);
	}
};

/**
 * "Range: 0 to 100 %" for the limits the link actually enforces.
 *
 * The bounds are expressions, so they are evaluated here rather than printed
 * literally -- a limit written Tank_Level.MaxEU has to show as the number the
 * operator will be held to.
 */
HmiDialogs.rangeText = function(rt, cfg)
{
	if (rt == null)
	{
		return null;
	}

	var lo = (cfg.min != null && cfg.min !== '') ?
		parseFloat(rt.evaluate(cfg.min).value) : NaN;
	var hi = (cfg.max != null && cfg.max !== '') ?
		parseFloat(rt.evaluate(cfg.max).value) : NaN;

	if (isNaN(lo) && isNaN(hi))
	{
		return null;
	}

	var tag = (rt.project != null) ? rt.project.getTag(cfg.tag) : null;
	var units = (tag != null && tag.engUnits) ? ' ' + tag.engUnits : '';

	if (isNaN(hi))
	{
		return 'Minimum ' + lo + units;
	}

	if (isNaN(lo))
	{
		return 'Maximum ' + hi + units;
	}

	return 'Range: ' + lo + ' to ' + hi + units;
};

/**
 * An on-screen keyboard for string entry.
 *
 * Deliberately a plain QWERTY rather than a full keyboard: this is for a touch
 * panel with no hardware keyboard, where the job is entering a recipe or batch
 * name, not writing prose.
 */
HmiDialogs.keyboard = function(input)
{
	var wrap = HmiDialogs.el('div', 'hmiKeyboard');
	var shifted = false;
	var keys = [];

	var rows = [
		'1234567890',
		'qwertyuiop',
		'asdfghjkl',
		'zxcvbnm'
	];

	function type(ch)
	{
		input.value += (shifted) ? ch.toUpperCase() : ch;
		input.focus();
	}

	function relabel()
	{
		for (var i = 0; i < keys.length; i++)
		{
			var ch = keys[i].hmiChar;
			keys[i].innerText = (shifted) ? ch.toUpperCase() : ch;
		}
	}

	for (var r = 0; r < rows.length; r++)
	{
		var row = HmiDialogs.el('div', 'hmiKeyboardRow');

		for (var c = 0; c < rows[r].length; c++)
		{
			(function(ch)
			{
				var btn = HmiDialogs.button(ch, function() { type(ch); });
				btn.hmiChar = ch;
				keys.push(btn);
				row.appendChild(btn);
			})(rows[r].charAt(c));
		}

		wrap.appendChild(row);
	}

	var last = HmiDialogs.el('div', 'hmiKeyboardRow');

	last.appendChild(HmiDialogs.button('\u21e7', function()
	{
		shifted = !shifted;
		relabel();
		input.focus();
	}));

	var space = HmiDialogs.button('space', function() { type(' '); });
	space.className += ' hmiKeySpace';
	last.appendChild(space);

	last.appendChild(HmiDialogs.button('-', function() { type('-'); }));
	last.appendChild(HmiDialogs.button('_', function() { type('_'); }));
	last.appendChild(HmiDialogs.button('.', function() { type('.'); }));

	last.appendChild(HmiDialogs.button('\u232b', function()
	{
		input.value = input.value.substring(0, input.value.length - 1);
		input.focus();
	}));

	last.appendChild(HmiDialogs.button('CLR', function()
	{
		input.value = '';
		input.focus();
	}));

	wrap.appendChild(last);

	return wrap;
};

/**
 * A numeric keypad that types into the given field.
 *
 * Keys write through the field rather than to a value of their own, so the
 * typed text, the keypad and the validation all read the same place and a
 * touch user and a keyboard user can use the same dialog interchangeably.
 */
HmiDialogs.keypad = function(input)
{
	var pad = HmiDialogs.el('div', 'hmiKeypad');

	var keys = ['7', '8', '9', '1', '2', '3', '4', '5', '6', '0', '.', '-'];

	function press(key)
	{
		if (key === '-')
		{
			// Toggle the sign rather than inserting a stray minus, which is
			// what a person means by the key on a numeric pad.
			input.value = (input.value.charAt(0) === '-') ?
				input.value.substring(1) : '-' + input.value;
		}
		else if (key === '.' && input.value.indexOf('.') >= 0)
		{
			return;
		}
		else
		{
			input.value += key;
		}

		input.focus();
	}

	for (var i = 0; i < keys.length; i++)
	{
		(function(key)
		{
			pad.appendChild(HmiDialogs.button(key, function() { press(key); }));
		})(keys[i]);
	}

	pad.appendChild(HmiDialogs.button('\u232b', function()
	{
		input.value = input.value.substring(0, input.value.length - 1);
		input.focus();
	}));

	pad.appendChild(HmiDialogs.button('CLR', function()
	{
		input.value = '';
		input.focus();
	}));

	return pad;
};

// ---------------------------------------------------------- validation

HmiDialogs.showValidation = function(ui, problems)
{
	var div = HmiDialogs.el('div', 'hmiDialog');
	div.appendChild(HmiDialogs.el('div', 'hmiDialogTitle',
		'Expression Validation'));

	var body = HmiDialogs.el('div', 'hmiDialogBody hmiDialogBodyPlain');

	if (problems.length === 0)
	{
		body.appendChild(HmiDialogs.el('div', 'hmiEmpty',
			'No problems found.'));
	}
	else
	{
		for (var i = 0; i < problems.length; i++)
		{
			(function(p)
			{
				var row = HmiDialogs.el('div', 'hmiProblemRow');
				row.appendChild(HmiDialogs.el('div', 'hmiProblemWhere',
					p.page + ' › ' + p.link));
				row.appendChild(HmiDialogs.el('div', 'hmiProblemWhat',
					p.message));

				// Clicking selects the offending cell, which is what makes
				// this usable on a screen with hundreds of objects.
				mxEvent.addListener(row, 'click', function()
				{
					if (p.cell == null)
					{
						return;
					}

					ui.hideDialog();
					ui.editor.graph.setSelectionCell(p.cell);
					ui.editor.graph.scrollCellToVisible(p.cell);
				});

				body.appendChild(row);
			})(problems[i]);
		}
	}

	div.appendChild(body);

	var footer = HmiDialogs.el('div', 'hmiDialogFooter');
	footer.appendChild(HmiDialogs.el('span', 'hmiSpacer'));
	footer.appendChild(HmiDialogs.button(mxResources.get('close'), function()
	{
		ui.hideDialog();
	}, true));

	div.appendChild(footer);
	ui.showDialog(div, 560, 420, true, true);
};

// ----------------------------------------------------------------- log

HmiDialogs.showLog = function(ui)
{
	var lines = [];

	for (var i = 0; i < HmiLog.ring.length; i++)
	{
		var e = HmiLog.ring[i];
		lines.push(new Date(e.t).toLocaleTimeString() + '  [' + e.level +
			']  ' + e.msg);
	}

	ui.showDialog(new HmiTextDialog(ui, 'Runtime Log',
		(lines.length > 0) ? lines.join('\n') : 'Nothing logged.').container,
		620, 420, true, true);
};
