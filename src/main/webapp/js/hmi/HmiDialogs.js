/**
 * Dialogs: tag dictionary, devices, runtime user input, validation results
 * and the runtime log.
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

			// An indirect tag keeps only its name, type and comment
			if (HmiTypes.isIndirect(value))
			{
				for (var key in tag)
				{
					if (key !== 'name' && key !== 'type' && key !== 'comment')
					{
						delete tag[key];
					}
				}
			}
			else if (tag.initial === undefined)
			{
				var fresh = HmiProject.createTag(tag.name, value);

				for (var k in fresh)
				{
					if (tag[k] === undefined)
					{
						tag[k] = fresh[k];
					}
				}
			}

			that.markModified();
			that.renderList();
			that.renderForm();
		});

	// Also the alarm's description
	HmiDialogs.field(this.formDiv, 'Comment', tag.comment,
		function(v)
		{
			if (tag.comment !== v)
			{
				tag.comment = v;
				that.markModified();
			}
		}).setAttribute('data-hmi-prop', 'comment');

	if (HmiTypes.isIndirect(tag.type))
	{
		this.formDiv.appendChild(HmiDialogs.el('div', 'hmiHint',
			'An indirect tag stands for another tag, chosen while the application runs by a script: ' +
			'LinkIndirectTag("' + tag.name + '", "TagName"). Reading or writing it reads or writes that tag. ' +
			'It can be linked to ' + (HmiTypes.isDiscrete(tag.type) ? 'discrete' :
			(HmiTypes.isMessage(tag.type) ? 'message' : 'integer and real')) + ' tags.'));

		return;
	}

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

		var names = [{value: '', label: '(none)'}];

		for (var i = 0; i < this.project.devices.length; i++)
		{
			names.push(this.project.devices[i].name);
		}

		// Keep a device name that no longer exists visible rather than
		// silently blanking the tag's binding.
		if (tag.device && this.project.getDevice(tag.device) == null)
		{
			names.push({value: tag.device, label: tag.device + ' (missing)'});
		}

		HmiDialogs.select(this.formDiv, 'Device', tag.device || '', names, function(v)
		{
			tag.device = v;
			that.markModified();
			that.renderForm();
		});

		var device = this.project.getDevice(tag.device);

		if (device != null && device.protocol === 'simulator')
		{
			this.formDiv.appendChild(HmiDialogs.el('div', 'hmiHint',
				'Simulated: the value comes from the simulator, not a device.'));
		}
		else
		{
			var def = (device != null) ? HmiProject.protocol(device.protocol) : null;
			var note = HmiDialogs.el('div', 'hmiAddressNote');
			var address = HmiDialogs.field(this.formDiv, 'Address', tag.address, function(v)
			{
				tag.address = ('' + v).trim();
				that.markModified();
				HmiDialogs.checkAddress(device, tag, note);
			});

			address.setAttribute('placeholder', (def != null && def.placeholder) ?
				def.placeholder : 'Choose a device first');
			address.setAttribute('data-hmi-prop', 'address');
			this.formDiv.appendChild(note);

			var timer = null;

			mxEvent.addListener(address, 'input', function()
			{
				window.clearTimeout(timer);
				timer = window.setTimeout(function()
				{
					HmiDialogs.checkAddress(device, {type: tag.type, address: address.value.trim()}, note);
				}, 400);
			});

			HmiDialogs.checkAddress(device, tag, note);
		}

		// Scaling is opt-in: a device value is shown as the device holds it
		// unless a raw range is to be mapped onto the engineering range.
		if (HmiTypes.isAnalog(tag.type) && (device == null || device.protocol !== 'simulator'))
		{
			HmiDialogs.field(this.formDiv, 'Scale raw values', tag.scaled === true, function(v)
			{
				tag.scaled = !!v;
				that.markModified();
				that.renderForm();
			}, 'checkbox').setAttribute('data-hmi-prop', 'scaled');

			if (tag.scaled === true)
			{
				HmiDialogs.field(this.formDiv, 'Minimum raw', tag.minRaw,
					function(v) { tag.minRaw = parseFloat(v) || 0; }).setAttribute('data-hmi-prop', 'minRaw');
				HmiDialogs.field(this.formDiv, 'Maximum raw', tag.maxRaw,
					function(v) { tag.maxRaw = parseFloat(v) || 0; }).setAttribute('data-hmi-prop', 'maxRaw');
				this.formDiv.appendChild(HmiDialogs.el('div', 'hmiHint',
					'Raw minimum to maximum is shown as the engineering minimum to maximum.'));
			}
		}
	}

	// Retentive memory tags keep their last value from one Run to the next
	if (!HmiTypes.isIO(tag.type))
	{
		HmiDialogs.field(this.formDiv, 'Retentive', tag.retentive === true, function(v)
		{
			if (v) { tag.retentive = true; }
			else { delete tag.retentive; }

			that.markModified();
		}, 'checkbox').setAttribute('data-hmi-prop', 'retentive');

		this.formDiv.appendChild(HmiDialogs.el('div', 'hmiHint',
			'Keeps the last value: the next Run starts from it instead of the initial value.'));
	}

	// The tag's comment is the alarm's description
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
						var n = parseFloat(v);

						if (v === '' || isNaN(n)) { delete tag.alarms[key]; }
						else { tag.alarms[key] = n; }

						that.markModified();
					}).setAttribute('data-hmi-prop', 'alarm.' + key);
			})(limits[i][0]);
		}

		this.formDiv.appendChild(HmiDialogs.el('div', 'hmiHint',
			'Leave a limit empty for no alarm there. An alarm clears only once ' +
			'the value is back inside its limit by the deadband.'));
	}
	else if (HmiTypes.isDiscrete(tag.type))
	{
		this.formDiv.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Alarm'));

		HmiDialogs.select(this.formDiv, 'Alarm when',
			(tag.alarms != null && tag.alarms.state) || '', [
				{value: '', label: 'No alarm'},
				{value: 'on', label: 'On (1)'},
				{value: 'off', label: 'Off (0)'}],
			function(v)
			{
				if (v === '')
				{
					if (tag.alarms != null) { delete tag.alarms.state; }
				}
				else
				{
					tag.alarms = tag.alarms || {};
					tag.alarms.state = v;
				}

				that.markModified();
			}).setAttribute('data-hmi-prop', 'alarm.state');
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

			that.markModified();
		});

	HmiDialogs.field(this.formDiv, 'Period (ms)', tag.sim.periodMs,
		function(v)
		{
			if (v === '') { delete tag.sim.periodMs; }
			else { tag.sim.periodMs = v; }

			that.markModified();
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

	if (HmiTypes.systemTag(next) != null)
	{
		this.ui.showError(mxResources.get('error'),
			'"' + HmiTypes.systemTag(next) + '" is a system tag name and cannot be used.',
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
	this.project.touch();
	this.ui.editor.setModified(true);
};

// --------------------------------------------------------------- CSV

/**
 * A flat CSV of the scalar fields, which is what an engineer actually wants
 * for bulk edits in a spreadsheet.
 */
HmiTagDialog.CSV_FIELDS = ['name', 'type', 'comment', 'engUnits', 'initial',
	'minEU', 'maxEU', 'scaled', 'minRaw', 'maxRaw', 'device', 'address', 'onMsg', 'offMsg',
	'retentive', 'alarmLoLo', 'alarmLow', 'alarmHigh', 'alarmHiHi', 'alarmDeadband', 'alarmState'];

/** CSV columns kept in tag.alarms, with the key there. */
HmiTagDialog.CSV_ALARM_FIELDS = {alarmLoLo: 'loLo', alarmLow: 'low', alarmHigh: 'high',
	alarmHiHi: 'hiHi', alarmDeadband: 'deadband', alarmState: 'state'};

HmiTagDialog.csvValue = function(tag, field)
{
	var key = HmiTagDialog.CSV_ALARM_FIELDS[field];

	return (key != null) ? ((tag.alarms != null) ? tag.alarms[key] : null) : tag[field];
};

HmiTagDialog.prototype.exportCsv = function()
{
	var rows = [HmiTagDialog.CSV_FIELDS.join(',')];

	for (var i = 0; i < this.project.tags.length; i++)
	{
		var tag = this.project.tags[i];
		var cells = [];

		for (var f = 0; f < HmiTagDialog.CSV_FIELDS.length; f++)
		{
			cells.push(HmiTagDialog.csvCell(HmiTagDialog.csvValue(tag, HmiTagDialog.CSV_FIELDS[f])));
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
			if (HmiTypes.systemTag(record.name) != null)
			{
				continue;
			}

			tag = HmiProject.createTag(record.name, type);
			this.project.addTag(tag);
			added++;
		}

		tag.type = type;

		// An indirect tag keeps only its name, type and comment
		if (HmiTypes.isIndirect(type))
		{
			for (var key in tag)
			{
				if (key !== 'name' && key !== 'type' && key !== 'comment')
				{
					delete tag[key];
				}
			}
		}

		for (var f = 0; f < HmiTagDialog.CSV_FIELDS.length; f++)
		{
			var field = HmiTagDialog.CSV_FIELDS[f];

			if (field === 'name' || field === 'type' ||
				record[field] == null || record[field] === '' ||
				(HmiTypes.isIndirect(type) && field !== 'comment'))
			{
				continue;
			}

			var alarmKey = HmiTagDialog.CSV_ALARM_FIELDS[field];

			if (alarmKey != null)
			{
				tag.alarms = tag.alarms || {};
				tag.alarms[alarmKey] = (alarmKey === 'state') ? record[field] :
					parseFloat(record[field]);

				continue;
			}

			var numeric = (field === 'minEU' || field === 'maxEU' ||
				field === 'minRaw' || field === 'maxRaw' ||
				(field === 'initial' && !HmiTypes.isMessage(type)));

			tag[field] = (numeric) ? parseFloat(record[field]) :
				(field === 'scaled' || field === 'retentive') ?
					(record[field] === 'true' || record[field] === '1') : record[field];
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

/**
 * HMI > Devices: each device is a logical name, where it is and how to talk
 * to it. Tags name the device they read through, so a rename here follows
 * into every tag, and a device still in use cannot be removed.
 */
HmiDialogs.showDevices = function(ui)
{
	if (ui.hmiProject == null)
	{
		ui.hmiProject = HmiFile.createDefaultProject();
	}

	var project = ui.hmiProject;
	var selected = project.devices[0] || null;

	var div = HmiDialogs.el('div', 'hmiDialog');
	div.appendChild(HmiDialogs.el('div', 'hmiDialogTitle', mxResources.get('hmiDevices')));

	var body = HmiDialogs.el('div', 'hmiDialogBody hmiDevices');
	var list = HmiDialogs.el('div', 'hmiTagList hmiDeviceList');
	var form = HmiDialogs.el('div', 'hmiTagForm hmiDeviceForm');
	body.appendChild(list);
	body.appendChild(form);
	div.appendChild(body);

	var changed = function()
	{
		project.touch();
		ui.editor.setModified(true);
	};

	var renderList = function()
	{
		list.innerText = '';

		for (var i = 0; i < project.devices.length; i++)
		{
			(function(d)
			{
				var row = HmiDialogs.el('div', 'hmiTagRow' + ((d === selected) ? ' hmiTagRowOn' : ''));
				row.setAttribute('data-hmi-device', d.name);
				row.appendChild(HmiDialogs.el('div', 'hmiTagName', d.name));
				var def = HmiProject.protocol(d.protocol);
				row.appendChild(HmiDialogs.el('div', 'hmiTagType',
					((def != null) ? def.label : d.protocol) + (d.host ? ' — ' + d.host : '') +
					(d.enabled === false ? ' (disabled)' : '')));

				mxEvent.addListener(row, 'click', function()
				{
					selected = d;
					renderList();
					renderForm();
				});

				list.appendChild(row);
			})(project.devices[i]);
		}

		if (project.devices.length === 0)
		{
			list.appendChild(HmiDialogs.el('div', 'hmiEmpty', 'No devices defined.'));
		}
	};

	var renderForm = function()
	{
		form.innerText = '';

		if (selected == null)
		{
			form.appendChild(HmiDialogs.el('div', 'hmiEmpty', 'Select a device, or add one.'));

			return;
		}

		var d = selected;
		var error = HmiDialogs.el('div', 'hmiError');

		var name = HmiDialogs.field(form, 'Name', d.name, function(v)
		{
			v = ('' + v).trim();
			error.innerText = '';

			if (v === d.name)
			{
				return;
			}

			if (!/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(v))
			{
				error.innerText = 'A name is a letter or _ followed by letters, digits or _.';
				name.value = d.name;

				return;
			}

			var other = project.getDevice(v);

			if (other != null && other !== d)
			{
				error.innerText = 'There is already a device called ' + other.name + '.';
				name.value = d.name;

				return;
			}

			project.renameDevice(d.name, v);
			changed();
			renderList();
		});
		name.setAttribute('data-hmi-prop', 'name');

		var protocols = HmiProject.PROTOCOLS.map(function(p) { return {value: p.value, label: p.label}; });

		HmiDialogs.select(form, 'Protocol', d.protocol, protocols, function(v)
		{
			var fresh = HmiProject.createDevice(d.name, v);
			d.protocol = v;
			d.port = fresh.port;
			d.options = fresh.options;
			changed();
			renderList();
			renderForm();
		}).setAttribute('data-hmi-prop', 'protocol');

		var def = HmiProject.protocol(d.protocol);

		if (d.protocol !== 'simulator')
		{
			form.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Connection'));

			HmiDialogs.field(form, 'IP address or host', d.host, function(v)
			{
				d.host = ('' + v).trim();
				changed();
				renderList();
			}).setAttribute('data-hmi-prop', 'host');

			HmiDialogs.field(form, 'Port', d.port, function(v)
			{
				var n = parseInt(v, 10);
				d.port = (n >= 1 && n <= 65535) ? n : def.port;
				changed();
			}, 'number').setAttribute('data-hmi-prop', 'port');

			HmiDialogs.field(form, 'Timeout (ms)', d.timeoutMs, function(v)
			{
				d.timeoutMs = Math.max(100, parseInt(v, 10) || 3000);
				changed();
			}, 'number');

			for (var i = 0; i < def.options.length; i++)
			{
				(function(o)
				{
					var value = (d.options[o.key] != null) ? d.options[o.key] : o.def;
					var input;

					if (o.type === 'bool')
					{
						input = HmiDialogs.field(form, o.label, value, function(v)
						{
							d.options[o.key] = !!v;
							changed();
						}, 'checkbox');
					}
					else if (o.type === 'select')
					{
						input = HmiDialogs.select(form, o.label, value, o.choices, function(v)
						{
							d.options[o.key] = v;
							changed();
						});
					}
					else
					{
						input = HmiDialogs.field(form, o.label, value, function(v)
						{
							var n = parseInt(v, 10);
							d.options[o.key] = isNaN(n) ? o.def : n;
							changed();
						}, 'number');
					}

					input.setAttribute('data-hmi-prop', o.key);
				})(def.options[i]);
			}
		}

		form.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Polling'));

		HmiDialogs.field(form, 'Scan rate (ms)', d.scanMs, function(v)
		{
			d.scanMs = Math.max(10, parseInt(v, 10) || 250);
			changed();
		}, 'number').setAttribute('data-hmi-prop', 'scanMs');

		HmiDialogs.field(form, 'Enabled', d.enabled !== false, function(v)
		{
			d.enabled = !!v;
			changed();
			renderList();
		}, 'checkbox');

		var users = project.deviceUsers(d.name);
		form.appendChild(HmiDialogs.el('div', 'hmiHint', (users.length === 0) ? 'No tags use this device.' :
			(users.length === 1) ? '1 tag uses this device.' : users.length + ' tags use this device.'));

		if (d.protocol !== 'simulator')
		{
			var probeRow = HmiDialogs.el('div', 'hmiFormRow');
			probeRow.appendChild(HmiDialogs.el('span', 'hmiFormLabel'));
			var result = HmiDialogs.el('div', 'hmiProbeResult');
			var test = HmiDialogs.button('Test Connection', function()
			{
				result.className = 'hmiProbeResult';
				result.innerText = 'Connecting…';

				HmiComms.probe(d, function(r)
				{
					result.className = 'hmiProbeResult ' + (r.ok ? 'hmiProbeOk' : 'hmiProbeFail');
					result.innerText = r.ok ? 'Connected in ' + Math.round(r.ms) + ' ms' : r.error;
				});
			});

			test.setAttribute('data-hmi-action', 'probe');
			probeRow.appendChild(test);
			form.appendChild(probeRow);
			form.appendChild(result);
		}

		form.appendChild(error);
	};

	renderList();
	renderForm();

	var footer = HmiDialogs.el('div', 'hmiDialogFooter');

	footer.appendChild(HmiDialogs.button('Add', function()
	{
		var n = project.devices.length + 1;

		while (project.getDevice('PLC' + n) != null)
		{
			n++;
		}

		selected = HmiProject.createDevice('PLC' + n, 'logix');
		project.devices.push(selected);
		changed();
		renderList();
		renderForm();
	}));

	var remove = HmiDialogs.button('Remove', function()
	{
		if (selected == null)
		{
			return;
		}

		var users = project.deviceUsers(selected.name);

		if (users.length > 0)
		{
			ui.showError(mxResources.get('error'), selected.name + ' is used by ' +
				users.slice(0, 8).join(', ') + (users.length > 8 ? ' and ' + (users.length - 8) + ' more' : '') +
				'. Point those tags at another device first.', mxResources.get('ok'));

			return;
		}

		project.removeDevice(selected.name);
		selected = project.devices[0] || null;
		changed();
		renderList();
		renderForm();
	});

	remove.setAttribute('data-hmi-action', 'remove');
	footer.appendChild(remove);
	footer.appendChild(HmiDialogs.el('span', 'hmiSpacer'));
	footer.appendChild(HmiDialogs.button(mxResources.get('close'), function()
	{
		ui.hideDialog();
	}, true));

	div.appendChild(footer);
	ui.showDialog(div, 720, 600, true, true);
};

/**
 * Checks an I/O tag's address with the comms server, which owns the address
 * grammars, and shows what it made of it: the canonical spelling, or why it
 * is wrong.
 */
HmiDialogs.checkAddress = function(device, tag, note)
{
	note.className = 'hmiAddressNote';
	note.innerText = '';

	if (device == null || device.protocol === 'simulator')
	{
		return;
	}

	if (!tag.address)
	{
		note.className = 'hmiAddressNote hmiAddressBad';
		note.innerText = 'An address is required.';

		return;
	}

	HmiComms.validate(device, [tag.address], HmiComms.dataTypeHint(tag), function(results, error)
	{
		if (error != null)
		{
			note.innerText = error;

			return;
		}

		var r = results[0];

		if (r.ok)
		{
			note.className = 'hmiAddressNote hmiAddressOk';
			note.innerText = r.normalized + ((r.dataType && r.dataType !== 'Unknown') ?
				' — ' + r.dataType : '') + (r.writable === false ? ', read-only' : '');
		}
		else
		{
			note.className = 'hmiAddressNote hmiAddressBad';
			note.innerText = r.error;
		}
	});
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
		options.push({value: r[0] + 'x' + r[1], label: r[0] + ' \u00D7 ' + r[1]});
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

	// How a published package runs on the target PC (HMI > Publish)
	var rt = project.settings.runtime;
	var windowMode = rt.windowMode;
	var exitMode = rt.exit;

	body.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Runtime'));
	body.appendChild(HmiDialogs.el('div', 'hmiHint',
		'How the published application runs on the target PC. Kiosk fills ' +
		'the screen and hides the taskbar; Windows keys and Ctrl+Alt+Del ' +
		'still work unless Windows itself is locked down. The exit shortcut ' +
		'is Ctrl+Alt+Shift+Q.'));

	HmiDialogs.select(body, 'Window', windowMode, [
		{value: 'kiosk', label: 'Kiosk (full screen, locked)'},
		{value: 'fullscreen', label: 'Full screen'},
		{value: 'window', label: 'Window at the target resolution'}],
		function(v) { windowMode = v; });

	var pwRow;

	var exitSelect = HmiDialogs.select(body, 'Exit', exitMode, [
		{value: 'shortcut', label: 'Exit shortcut'},
		{value: 'password', label: 'Exit shortcut and password'},
		{value: 'never', label: 'Never (shut down Windows to stop)'}],
		function(v)
		{
			exitMode = v;
			pwRow.style.display = (v === 'password') ? '' : 'none';
		});
	exitSelect.setAttribute('data-hmi-field', 'exit');

	var pwInput = HmiDialogs.field(body, 'Exit password', '', function() {},
		'password');
	pwInput.setAttribute('data-hmi-field', 'exitPassword');
	pwInput.setAttribute('placeholder', (rt.hash) ? 'Unchanged' : '');
	pwInput.setAttribute('autocomplete', 'new-password');
	pwRow = pwInput.parentNode;
	pwRow.style.display = (exitMode === 'password') ? '' : 'none';

	// Users log in with ShowLogin(); HMI > Users defines them
	var sec = project.settings.security;

	body.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Security'));
	body.appendChild(HmiDialogs.el('div', 'hmiHint',
		'Logs the user out after this many minutes without a touch or key ' +
		'press. 0 never logs out.'));
	var logoutInput = HmiDialogs.field(body, 'Log out after (min)', String(sec.autoLogoutMin || 0),
		function() {});
	logoutInput.setAttribute('data-hmi-field', 'autoLogoutMin');

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

		var password = pwInput.value;
		var logout = Number(logoutInput.value);

		if (!(logout >= 0 && logout <= 1440 && Math.floor(logout) === logout))
		{
			error.innerText = 'Log out after must be a whole number of minutes from 0 to 1440.';

			return false;
		}

		if (exitMode === 'password' && !password && !rt.hash)
		{
			error.innerText = 'Enter the exit password.';

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
			s.startup.join('\n') !== ids.join('\n') ||
			rt.windowMode !== windowMode || rt.exit !== exitMode ||
			(sec.autoLogoutMin || 0) !== logout;

		sec.autoLogoutMin = logout;

		// Windows left at full-screen size follow the new resolution, since
		// an unset size means "the screen".
		s.width = w;
		s.height = h;
		s.startup = ids;
		rt.windowMode = windowMode;
		rt.exit = exitMode;

		if (exitMode !== 'password')
		{
			changed = changed || rt.hash !== '';
			rt.salt = '';
			rt.hash = '';
		}
		else if (password)
		{
			// Only the hash is kept. Web Crypto is asynchronous, so the
			// project is marked modified again once it has it.
			var salt = HmiProject.randomSalt();

			HmiProject.hashPassword(salt, password).then(function(hash)
			{
				rt.salt = salt;
				rt.hash = hash;
				project.touch();
				ui.editor.setModified(true);
			});
		}

		if (changed)
		{
			project.touch();
			ui.editor.setModified(true);
			HmiFrame.refresh(ui);
		}

		return true;
	};

	HmiDialogs.okCancel(ui, div, apply);
	ui.showDialog(div, 460, 600, true, true);
};

/** "Popup, title bar, 400 \u00D7 300 at 10, 20" */
HmiDialogs.windowSummary = function(w)
{
	var type = {replace: 'Replace', overlay: 'Overlay', popup: 'Popup'}[w.type];

	return type + ((w.titleBar) ? ', title bar' : '') + ', ' +
		w.width + ' \u00D7 ' + w.height + ' at ' + w.x + ', ' + w.y;
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
			'Position and size (screen is ' + res.width + ' \u00D7 ' +
			res.height + ')'));
		fields.appendChild(HmiDialogs.el('div', 'hmiHint',
			'The window shows the part of the page inside it -- the dashed ' +
			'border on the canvas. Moving the window does not move what is ' +
			'drawn.'));

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
			var b = HmiDialogs.pageContentBounds(ui, current);

			if (b != null)
			{
				var tb = (d.titleBar) ? HmiProject.TITLE_BAR_HEIGHT : 0;
				d.x = Math.floor(b.x);
				d.y = Math.floor(b.y) - tb;
				d.width = Math.ceil(b.x + b.width) - d.x;
				d.height = Math.ceil(b.y + b.height) - Math.floor(b.y) + tb;
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

		fields.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Scripts'));

		var script = function(key, label)
		{
			HmiDialogs.scriptArea(fields, label, d[key], project, function(v)
			{
				d[key] = v;
			}).setAttribute('data-hmi-prop', key);
		};

		script('onShow', 'On show');
		script('whileShowing', 'While showing');

		var every = HmiDialogs.field(fields, 'Every (ms)', d.everyMs,
			function(v) { d.everyMs = v; });
		every.setAttribute('data-hmi-prop', 'everyMs');
		every.setAttribute('placeholder', HmiProject.DEFAULT_WINDOW_EVERY_MS);
		mxEvent.addListener(every, 'input', function() { d.everyMs = every.value; });

		script('onHide', 'On hide');

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
			HmiFrame.refresh(ui);
		}

		return true;
	};

	HmiDialogs.okCancel(ui, div, apply);
	ui.showDialog(div, 480, Math.max(480, Math.min(900, window.innerHeight - 60)),
		true, true);
};

HmiDialogs.radioCounter = 0;

/**
 * A labelled QuickScript field, checked as it is typed. Reports every change,
 * not only on blur, so OK never loses the last keystrokes.
 */
HmiDialogs.scriptArea = function(parent, label, value, project, onChange)
{
	var row = HmiDialogs.el('div', 'hmiFormRow hmiFormRowTop');
	row.appendChild(HmiDialogs.el('label', 'hmiFormLabel', label));

	var area = document.createElement('textarea');
	area.className = 'hmiInput hmiScript';
	area.setAttribute('rows', '3');
	area.setAttribute('placeholder', 'QuickScript statements');
	area.value = (value != null) ? value : '';

	var check = function()
	{
		var errors = (area.value !== '') ? HmiExpr.compile(area.value,
			{project: project, mode: 'script'}).errors : [];

		if (errors.length > 0)
		{
			area.classList.add('hmiInvalid');
			area.setAttribute('title', errors[0].message);
		}
		else
		{
			area.classList.remove('hmiInvalid');
			area.removeAttribute('title');
		}
	};

	mxEvent.addListener(area, 'input', function()
	{
		check();
		onChange(area.value);
	});

	check();
	row.appendChild(area);
	parent.appendChild(row);

	return area;
};

/**
 * The bounds of a page's content, in page -- and so screen -- coordinates.
 */
HmiDialogs.pageContentBounds = function(ui, page)
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

	return bounds;
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
		// A masked entry (passwords) neither shows what is typed nor the
		// value it replaces
		var masked = cfg.kind === 'string' && cfg.masked === true;

		input = HmiDialogs.field(body, 'Value', (masked) ? '' :
			((current.value != null) ? current.value : ''), function() {},
			(masked) ? 'password' : null);

		if (masked)
		{
			input.setAttribute('autocomplete', 'off');
		}

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

// ---------------------------------------------------------------- publish

/**
 * HMI > Publish: builds a Windows installer that runs this project in the
 * desktop app's run-only mode, with the comms server (src/main/publish in the
 * desktop app). Validation problems are offered for review first.
 */
HmiDialogs.showPublish = function(ui)
{
	if (window.electron == null || typeof window.electron.request !== 'function')
	{
		ui.showError(mxResources.get('hmiPublish'), 'Publish needs the desktop app.',
			mxResources.get('ok'));

		return;
	}

	if (HmiMenus.isRunning(ui))
	{
		HmiMenus.stop(ui);
	}

	if (ui.hmiProject == null)
	{
		ui.hmiProject = HmiFile.createDefaultProject();
	}

	HmiMenus.collectProblems(ui, function(problems)
	{
		if (problems.length === 0)
		{
			HmiDialogs.checkPublishTools(ui);
		}
		else
		{
			ui.confirm(problems.length + ((problems.length === 1) ? ' problem was' :
				' problems were') + ' found in the project. Publish anyway?', function()
			{
				HmiDialogs.checkPublishTools(ui);
			}, function()
			{
				HmiDialogs.showValidation(ui, problems);
			}, 'Publish anyway', 'Review');
		}
	});
};

HmiDialogs.publishRequest = function(action, args)
{
	return new Promise(function(resolve, reject)
	{
		var msg = args || {};
		msg.action = action;

		window.electron.request(msg, resolve, function(message)
		{
			reject(new Error(message));
		});
	});
};

HmiDialogs.checkPublishTools = function(ui)
{
	HmiDialogs.publishRequest('hmiPublish.available').then(function(tools)
	{
		if (tools.error != null)
		{
			ui.showError(mxResources.get('hmiPublish'), tools.error, mxResources.get('ok'));
		}
		else
		{
			HmiDialogs.showPublishOptions(ui, tools);
		}
	})['catch'](function(e)
	{
		ui.showError(mxResources.get('hmiPublish'), e.message, mxResources.get('ok'));
	});
};

/** "1.0.9" -> "1.0.10": the next publish suggests the next version. */
HmiDialogs.nextVersion = function(v)
{
	var parts = String(v || '').split('.');
	var last = parseInt(parts[parts.length - 1], 10);

	if (!/^\d+(\.\d+){0,3}$/.test(v || '') || isNaN(last))
	{
		return '1.0.0';
	}

	parts[parts.length - 1] = String(last + 1);

	return parts.join('.');
};

HmiDialogs.showPublishOptions = function(ui, tools)
{
	var project = ui.hmiProject;
	var last = project.settings.publish;
	var file = ui.getCurrentFile();
	var title = (file != null) ? file.getTitle().replace(/\.(ahmi|drawio-hmi|drawio)$/i, '') : '';

	var opts = {
		productName: last.productName || title || 'HMI Application',
		version: (last.version) ? HmiDialogs.nextVersion(last.version) : '1.0.0',
		publisher: last.publisher || '',
		icon: last.icon || '',
		scope: last.scope || 'user',
		desktop: last.desktop === true,
		autostart: last.autostart === true,
		compression: last.compression || 'small',
		output: last.output || tools.documents
	};

	var div = HmiDialogs.el('div', 'hmiDialog');
	div.appendChild(HmiDialogs.el('div', 'hmiDialogTitle', mxResources.get('hmiPublish')));

	var body = HmiDialogs.el('div', 'hmiDialogBody hmiDialogBodyPlain');
	body.appendChild(HmiDialogs.el('div', 'hmiHint',
		'Creates a Windows installer that runs this project full time on the ' +
		'target PC, with the comms server. Window mode and exit are set in ' +
		'Application Settings.'));

	var inputs = [];
	var track = function(el, field)
	{
		el.setAttribute('data-hmi-field', field);
		inputs.push(el);

		return el;
	};

	body.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Package'));
	var nameInput = track(HmiDialogs.field(body, 'Product name', opts.productName,
		function() {}), 'productName');
	var versionInput = track(HmiDialogs.field(body, 'Version', opts.version,
		function() {}), 'version');
	var publisherInput = track(HmiDialogs.field(body, 'Publisher', opts.publisher,
		function() {}), 'publisher');
	publisherInput.setAttribute('placeholder', 'Optional');

	// The exe, shortcut and window icon; the app's own when none is chosen
	var iconRow = HmiDialogs.el('div', 'hmiFormRow');
	iconRow.appendChild(HmiDialogs.el('label', 'hmiFormLabel', 'Icon'));
	var iconText = HmiDialogs.el('span', 'hmiPublishOutput');
	iconText.setAttribute('data-hmi-field', 'icon');
	iconRow.appendChild(iconText);

	var showIcon = function()
	{
		iconText.innerText = opts.icon || 'Default';
		iconText.setAttribute('title', opts.icon);
		iconClear.style.display = (opts.icon) ? '' : 'none';
	};

	iconRow.appendChild(track(HmiDialogs.button('Browse...', function()
	{
		HmiDialogs.publishRequest('hmiPublish.chooseIcon').then(function(p)
		{
			if (p != null)
			{
				opts.icon = p;
				showIcon();
			}
		})['catch'](function(e)
		{
			error.innerText = e.message;
		});
	}), 'iconBrowse'));

	var iconClear = track(HmiDialogs.button('Clear', function()
	{
		opts.icon = '';
		showIcon();
	}), 'iconClear');
	iconRow.appendChild(iconClear);
	body.appendChild(iconRow);
	showIcon();

	body.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Installer'));
	track(HmiDialogs.select(body, 'Install for', opts.scope, [
		{value: 'user', label: 'The user who installs it'},
		{value: 'machine', label: 'All users (needs administrator)'}],
		function(v) { opts.scope = v; }), 'scope');
	track(HmiDialogs.field(body, 'Desktop shortcut', opts.desktop,
		function(v) { opts.desktop = v; }, 'checkbox'), 'desktop');
	track(HmiDialogs.field(body, 'Start with Windows', opts.autostart,
		function(v) { opts.autostart = v; }, 'checkbox'), 'autostart');
	track(HmiDialogs.select(body, 'Compression', opts.compression, [
		{value: 'small', label: 'Smaller installer (a few minutes)'},
		{value: 'fast', label: 'Faster build (larger installer)'}],
		function(v) { opts.compression = v; }), 'compression');

	var outRow = HmiDialogs.el('div', 'hmiFormRow');
	outRow.appendChild(HmiDialogs.el('label', 'hmiFormLabel', 'Save to'));
	var outText = HmiDialogs.el('span', 'hmiPublishOutput', opts.output);
	outText.setAttribute('title', opts.output);
	outText.setAttribute('data-hmi-field', 'output');
	outRow.appendChild(outText);
	var browse = track(HmiDialogs.button('Browse...', function()
	{
		HmiDialogs.publishRequest('hmiPublish.chooseOutput', {defaultPath: opts.output})
			.then(function(dir)
		{
			if (dir != null)
			{
				opts.output = dir;
				outText.innerText = dir;
				outText.setAttribute('title', dir);
				error.innerText = '';
			}
		})['catch'](function(e)
		{
			error.innerText = e.message;
		});
	}), 'browse');
	outRow.appendChild(browse);
	body.appendChild(outRow);

	// Simulated devices keep simulating in the package
	var simulated = [];

	for (var i = 0; i < project.devices.length; i++)
	{
		if (project.devices[i].protocol === 'simulator' &&
			project.devices[i].enabled !== false)
		{
			simulated.push(project.devices[i].name);
		}
	}

	if (simulated.length > 0)
	{
		body.appendChild(HmiDialogs.el('div', 'hmiHint hmiWarning',
			'Simulated on the target PC too: ' + simulated.join(', ') + '.'));
	}

	var progress = HmiDialogs.el('div', 'hmiProgress');
	var bar = HmiDialogs.el('div', 'hmiProgressBar');
	progress.appendChild(bar);
	progress.style.display = 'none';
	body.appendChild(progress);

	var status = HmiDialogs.el('div', 'hmiPublishStatus');
	status.setAttribute('data-hmi-field', 'status');
	body.appendChild(status);

	var error = HmiDialogs.el('div', 'hmiError');
	body.appendChild(error);
	div.appendChild(body);

	var footer = HmiDialogs.el('div', 'hmiDialogFooter');
	var show = HmiDialogs.button('Show in folder', function()
	{
		HmiDialogs.publishRequest('hmiPublish.showFile', {path: built})['catch'](function(e)
		{
			error.innerText = e.message;
		});
	});
	show.style.display = 'none';
	footer.appendChild(show);
	footer.appendChild(HmiDialogs.el('span', 'hmiSpacer'));

	var building = false;
	var built = null;

	var cancel = HmiDialogs.button(mxResources.get('cancel'), function()
	{
		if (building)
		{
			HmiDialogs.publishRequest('hmiPublish.cancel')['catch'](function() {});
		}
		else
		{
			ui.hideDialog();
		}
	});
	footer.appendChild(cancel);

	var publish = HmiDialogs.button(mxResources.get('hmiPublish'), function()
	{
		start();
	}, true);
	publish.className += ' hmiOk';
	footer.appendChild(publish);
	div.appendChild(footer);

	var setBusy = function(busy)
	{
		building = busy;

		for (var i = 0; i < inputs.length; i++)
		{
			inputs[i].disabled = busy;
		}

		publish.disabled = busy;
		progress.style.display = (busy) ? '' : 'none';
	};

	HmiDialogs.onPublishEvent = function(ev)
	{
		bar.style.width = Math.max(0, Math.min(100, ev.percent)) + '%';

		if (ev.stage === 'preparing' || ev.stage === 'compressing')
		{
			status.innerText = ev.message + '... ' + ev.percent + '%';
		}
	};

	if (!HmiDialogs.publishListening)
	{
		HmiDialogs.publishListening = true;

		window.electron.registerMsgListener('hmiPublishEvent', function(ev)
		{
			if (HmiDialogs.onPublishEvent != null)
			{
				HmiDialogs.onPublishEvent(ev);
			}
		});
	}

	var start = function()
	{
		error.innerText = '';
		opts.productName = nameInput.value.trim();
		opts.version = versionInput.value.trim();
		opts.publisher = publisherInput.value.trim();

		if (!opts.productName)
		{
			error.innerText = 'Enter a product name.';

			return;
		}

		if (!/^\d{1,5}(\.\d{1,5}){0,3}$/.test(opts.version))
		{
			error.innerText = 'The version must be numbers separated by dots, such as 1.0.0.';

			return;
		}

		var s = project.settings;
		var xml = mxUtils.getXml(ui.getXmlFileData(true, false, true));

		setBusy(true);
		show.style.display = 'none';
		status.innerText = 'Preparing...';
		bar.style.width = '0%';

		HmiDialogs.publishRequest('hmiPublish.build', {projectXml: xml, output: opts.output,
			icon: opts.icon || null,
			options: {productName: opts.productName, version: opts.version,
				publisher: opts.publisher, scope: opts.scope, desktop: opts.desktop,
				autostart: opts.autostart, compression: opts.compression,
				width: s.width, height: s.height, runtime: s.runtime}}).then(function(path)
		{
			built = path;
			setBusy(false);
			status.innerText = 'Created ' + path;
			show.style.display = '';
			cancel.innerText = mxResources.get('close');
			publish.style.display = 'none';

			// Remembered with the project, so the next publish suggests the
			// next version
			var remembered = {};

			for (var i = 0; i < HmiProject.PUBLISH_FIELDS.length; i++)
			{
				var key = HmiProject.PUBLISH_FIELDS[i];
				remembered[key] = opts[key];
			}

			if (JSON.stringify(remembered) !== JSON.stringify(project.settings.publish))
			{
				project.settings.publish = remembered;
				project.touch();
				ui.editor.setModified(true);
			}
		})['catch'](function(e)
		{
			setBusy(false);
			status.innerText = '';
			error.innerText = (e.message === 'cancelled') ? 'Cancelled.' : e.message;
		});
	};

	ui.showDialog(div, 500, 560, true, false, function()
	{
		HmiDialogs.onPublishEvent = null;

		if (building)
		{
			HmiDialogs.publishRequest('hmiPublish.cancel')['catch'](function() {});
		}
	});
};

// ------------------------------------------------------------------ about

/**
 * Help > About: the product, its versions and the attribution the Apache
 * License asks for, with the licence texts one click away.
 */
HmiDialogs.showAbout = function(ui)
{
	var div = HmiDialogs.el('div', 'hmiDialog hmiAbout');

	var head = HmiDialogs.el('div', 'hmiAboutHead');
	var logo = document.createElement('img');
	logo.setAttribute('src', HmiBrand.LOGO);
	logo.className = 'hmiAboutLogo';
	head.appendChild(logo);

	var title = HmiDialogs.el('div', 'hmiAboutTitle');
	title.appendChild(HmiDialogs.el('div', 'hmiAboutName', HmiBrand.NAME));
	var version = HmiDialogs.el('div', 'hmiAboutVersion', '');
	version.setAttribute('data-hmi-field', 'version');
	title.appendChild(version);
	head.appendChild(title);
	div.appendChild(head);

	var body = HmiDialogs.el('div', 'hmiDialogBody hmiDialogBodyPlain');
	body.appendChild(HmiDialogs.el('div', 'hmiAboutText',
		'© ' + new Date().getFullYear() + ' ' + HmiBrand.PUBLISHER + '.'));
	var attribution = HmiDialogs.el('div', 'hmiAboutText',
		'Built on the draw.io diagram editor by JGraph Ltd, used and modified ' +
		'under the Apache License 2.0. Append HMI Studio is not affiliated with ' +
		'or endorsed by JGraph Ltd.');
	attribution.setAttribute('data-hmi-field', 'attribution');
	body.appendChild(attribution);
	div.appendChild(body);

	var info = null;

	var footer = HmiDialogs.el('div', 'hmiDialogFooter');
	var licences = HmiDialogs.button('Licenses...', function()
	{
		if (info != null)
		{
			HmiDialogs.showLicences(ui, info);
		}
	});
	licences.setAttribute('data-hmi-field', 'licences');
	footer.appendChild(licences);
	footer.appendChild(HmiDialogs.el('span', 'hmiSpacer'));
	footer.appendChild(HmiDialogs.button(mxResources.get('close'), function()
	{
		ui.hideDialog();
	}, true));
	div.appendChild(footer);

	var show = function(v)
	{
		info = v;
		version.innerText = 'Version ' + v.version + ((v.coreVersion) ?
			' (editor ' + v.coreVersion + ')' : '');
	};

	if (window.electron != null && typeof window.electron.request === 'function')
	{
		window.electron.request({action: 'hmiApp.info'}, show, function(message)
		{
			version.innerText = message;
		});
	}
	else
	{
		show({version: EditorUi.VERSION, coreVersion: null, license: '', notice: ''});
	}

	ui.showDialog(div, 440, 280, true, true);
};

HmiDialogs.showLicences = function(ui, info)
{
	var div = HmiDialogs.el('div', 'hmiDialog');
	div.appendChild(HmiDialogs.el('div', 'hmiDialogTitle', 'Licenses'));

	var text = document.createElement('textarea');
	text.className = 'hmiTextArea hmiLicenceText';
	text.setAttribute('readonly', 'readonly');
	text.setAttribute('data-hmi-field', 'licenceText');
	text.value = (info.notice || '') + '\n\n' + (info.license || '');
	div.appendChild(text);

	var footer = HmiDialogs.el('div', 'hmiDialogFooter');
	footer.appendChild(HmiDialogs.el('span', 'hmiSpacer'));
	footer.appendChild(HmiDialogs.button(mxResources.get('close'), function()
	{
		ui.hideDialog();
	}, true));
	div.appendChild(footer);

	ui.showDialog(div, 640, 520, true, true);
};

// ---------------------------------------------------------------- security

/**
 * An on-screen keyboard that types into whichever of the given inputs last
 * had focus (the login and user dialogs have several fields).
 */
HmiDialogs.sharedKeyboard = function(inputs)
{
	var target = inputs[0];

	for (var i = 0; i < inputs.length; i++)
	{
		(function(el)
		{
			mxEvent.addListener(el, 'focus', function() { target = el; });
		})(inputs[i]);
	}

	var proxy = {
		focus: function() { target.focus(); }
	};

	Object.defineProperty(proxy, 'value', {
		get: function() { return target.value; },
		set: function(v) { target.value = v; }
	});

	return HmiDialogs.keyboard(proxy);
};

/**
 * The prebuilt login window (ShowLogin()): user name and a masked password,
 * checked by the Run's HmiSecurityManager.
 */
HmiDialogs.showLogin = function(ui, security)
{
	var div = HmiDialogs.el('div', 'hmiDialog hmiLogin');
	div.appendChild(HmiDialogs.el('div', 'hmiDialogTitle', 'Log In'));

	var body = HmiDialogs.el('div', 'hmiDialogBody hmiDialogBodyPlain');
	var name = HmiDialogs.field(body, 'User name', '', function() {});
	name.setAttribute('data-hmi-field', 'loginName');
	name.setAttribute('autocomplete', 'off');
	var password = HmiDialogs.field(body, 'Password', '', function() {}, 'password');
	password.setAttribute('data-hmi-field', 'loginPassword');
	password.setAttribute('autocomplete', 'off');

	var error = HmiDialogs.el('div', 'hmiError');
	error.setAttribute('data-hmi-field', 'loginError');
	body.appendChild(error);

	var keyboard = HmiDialogs.sharedKeyboard([name, password]);
	keyboard.style.display = 'none';
	body.appendChild(keyboard);
	div.appendChild(body);

	var submit = function()
	{
		if (security.login(name.value.trim(), password.value))
		{
			ui.hideDialog();
		}
		else
		{
			password.value = '';
			error.innerText = 'Invalid user name or password.';
			password.focus();
		}
	};

	mxEvent.addListener(name, 'keydown', function(evt)
	{
		if (evt.keyCode == 13) { password.focus(); }
	});

	mxEvent.addListener(password, 'keydown', function(evt)
	{
		if (evt.keyCode == 13) { submit(); }
	});

	var footer = HmiDialogs.el('div', 'hmiDialogFooter');
	var kb = HmiDialogs.button('Keyboard', function()
	{
		var show = keyboard.style.display === 'none';
		keyboard.style.display = (show) ? '' : 'none';
		ui.dialog.container.style.height = (show ? 470 : 250) + 'px';
	});
	footer.appendChild(kb);
	footer.appendChild(HmiDialogs.el('span', 'hmiSpacer'));
	footer.appendChild(HmiDialogs.button(mxResources.get('cancel'), function() { ui.hideDialog(); }));
	var ok = HmiDialogs.button('Log In', submit, true);
	ok.setAttribute('data-hmi-field', 'loginSubmit');
	footer.appendChild(ok);
	div.appendChild(footer);

	ui.showDialog(div, 560, 250, true, true);
	window.setTimeout(function() { name.focus(); }, 0);
};

/**
 * Users and their access levels. In the editor (HMI > Users) this edits the
 * project; at run time (ShowUserManager(), options.runtime = the Run's
 * HmiSecurityManager) it edits the running list, which is saved on the
 * target PC. Passwords are only ever kept as hashes.
 */
HmiDialogs.showUsers = function(ui, options)
{
	var security = (options != null) ? options.runtime : null;

	if (security == null && ui.hmiProject == null)
	{
		ui.hmiProject = HmiFile.createDefaultProject();
	}

	var project = ui.hmiProject;

	var users = HmiSecurity.copyUsers((security != null) ? security.users : project.users);
	var editing = null;

	var div = HmiDialogs.el('div', 'hmiDialog hmiUsers');
	div.appendChild(HmiDialogs.el('div', 'hmiDialogTitle', 'Users'));

	var body = HmiDialogs.el('div', 'hmiDialogBody hmiDialogBodyPlain');
	body.appendChild(HmiDialogs.el('div', 'hmiHint', (security != null) ?
		'Changes are saved on this computer and replace the application\'s users here.' :
		'Access levels run from 0 to 9999. Animations read the logged-in user through ' +
		'_Username and _AccessLevel; ShowLogin() in a script opens the login window.'));

	var list = HmiDialogs.el('div', 'hmiUserList');
	body.appendChild(list);

	body.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'User'));
	var nameInput = HmiDialogs.field(body, 'Name', '', function() {});
	nameInput.setAttribute('data-hmi-field', 'userName');
	var levelInput = HmiDialogs.field(body, 'Access level', '0', function() {});
	levelInput.setAttribute('data-hmi-field', 'userLevel');
	var pwInput = HmiDialogs.field(body, 'Password', '', function() {}, 'password');
	pwInput.setAttribute('data-hmi-field', 'userPassword');
	pwInput.setAttribute('autocomplete', 'new-password');
	var pw2Input = HmiDialogs.field(body, 'Confirm password', '', function() {}, 'password');
	pw2Input.setAttribute('data-hmi-field', 'userPassword2');
	pw2Input.setAttribute('autocomplete', 'new-password');

	var error = HmiDialogs.el('div', 'hmiError');
	error.setAttribute('data-hmi-field', 'userError');
	body.appendChild(error);

	var keyboard = null;

	if (security != null)
	{
		keyboard = HmiDialogs.sharedKeyboard([nameInput, levelInput, pwInput, pw2Input]);
		keyboard.style.display = 'none';
		body.appendChild(keyboard);
	}

	div.appendChild(body);

	var clearForm = function()
	{
		editing = null;
		nameInput.value = '';
		levelInput.value = '0';
		pwInput.value = '';
		pw2Input.value = '';
		pwInput.setAttribute('placeholder', '');
		save.innerText = 'Add';
		error.innerText = '';
	};

	var render = function()
	{
		list.innerHTML = '';

		var table = HmiDialogs.el('table', 'hmiUserTable');
		var head = HmiDialogs.el('tr');
		head.appendChild(HmiDialogs.el('th', 'hmiUserName', 'User'));
		head.appendChild(HmiDialogs.el('th', 'hmiUserLevel', 'Access Level'));
		head.appendChild(HmiDialogs.el('th', 'hmiUserActions', ''));
		table.appendChild(HmiDialogs.el('thead')).appendChild(head);
		var tbody = table.appendChild(HmiDialogs.el('tbody'));
		list.appendChild(table);

		if (users.length === 0)
		{
			var empty = HmiDialogs.el('td', 'hmiEmpty', 'No users.');
			empty.setAttribute('colspan', '3');
			tbody.appendChild(HmiDialogs.el('tr')).appendChild(empty);
		}

		for (var i = 0; i < users.length; i++)
		{
			(function(u)
			{
				var row = HmiDialogs.el('tr', 'hmiUserRow');
				row.setAttribute('data-hmi-user', u.name);
				row.appendChild(HmiDialogs.el('td', 'hmiUserName', u.name));
				row.appendChild(HmiDialogs.el('td', 'hmiUserLevel', String(u.level)));
				var actions = row.appendChild(HmiDialogs.el('td', 'hmiUserActions'));

				actions.appendChild(HmiDialogs.button('Edit', function()
				{
					editing = u;
					nameInput.value = u.name;
					levelInput.value = String(u.level);
					pwInput.value = '';
					pw2Input.value = '';
					pwInput.setAttribute('placeholder', 'Unchanged');
					save.innerText = 'Update';
					error.innerText = '';
				}));

				var remove = HmiDialogs.button('Remove', function()
				{
					// Nobody removes the account they are using
					if (security != null && security.user != null &&
						security.user.name.toLowerCase() === u.name.toLowerCase())
					{
						error.innerText = 'You cannot remove the user you are logged in as.';

						return;
					}

					users.splice(mxUtils.indexOf(users, u), 1);
					changed = true;
					clearForm();
					render();
				});
				remove.setAttribute('data-hmi-field', 'remove');
				actions.appendChild(remove);
				tbody.appendChild(row);
			})(users[i]);
		}
	};

	var changed = false;

	var save = HmiDialogs.button('Add', function()
	{
		var name = nameInput.value.trim();
		var level = Number(levelInput.value.trim());
		var other = HmiSecurity.findUser(users, name);

		if (!HmiSecurity.validName(name))
		{
			error.innerText = 'A name has 1 to 32 letters, digits, spaces or . _ - @ and cannot be "None".';

			return;
		}

		if (other != null && other !== editing)
		{
			error.innerText = 'There is already a user named "' + other.name + '".';

			return;
		}

		if (!HmiSecurity.validLevel(level))
		{
			error.innerText = 'The access level is a whole number from 0 to 9999.';

			return;
		}

		if (pwInput.value !== pw2Input.value)
		{
			error.innerText = 'The passwords do not match.';

			return;
		}

		if (editing == null && pwInput.value === '')
		{
			error.innerText = 'Enter a password.';

			return;
		}

		var u = editing || {};
		u.name = name;
		u.level = level;

		if (pwInput.value !== '')
		{
			var h = HmiSecurity.hashPassword(pwInput.value);
			u.salt = h.salt;
			u.hash = h.hash;
			u.iterations = h.iterations;
		}

		if (editing == null)
		{
			users.push(u);
		}

		changed = true;
		clearForm();
		render();
	});
	save.setAttribute('data-hmi-field', 'userSave');

	var formButtons = HmiDialogs.el('div', 'hmiFormRow');
	formButtons.appendChild(HmiDialogs.el('span', 'hmiSpacer'));
	formButtons.appendChild(HmiDialogs.button('New', clearForm));
	formButtons.appendChild(save);
	body.insertBefore(formButtons, error);

	var footer = HmiDialogs.el('div', 'hmiDialogFooter');

	if (keyboard != null)
	{
		footer.appendChild(HmiDialogs.button('Keyboard', function()
		{
			keyboard.style.display = (keyboard.style.display === 'none') ? '' : 'none';
		}));
	}

	footer.appendChild(HmiDialogs.el('span', 'hmiSpacer'));
	footer.appendChild(HmiDialogs.button(mxResources.get('cancel'), function() { ui.hideDialog(); }));

	var ok = HmiDialogs.button(mxResources.get('ok'), function()
	{
		if (changed)
		{
			if (security != null)
			{
				security.setUsers(users);
			}
			else
			{
				project.users = HmiSecurity.copyUsers(users);
				project.touch();
				ui.editor.setModified(true);
			}
		}

		ui.hideDialog();
	}, true);
	ok.className += ' hmiOk';
	footer.appendChild(ok);
	div.appendChild(footer);

	render();
	ui.showDialog(div, 560, (security != null) ? 720 : 560, true, true);
};

// ----------------------------------------------------------------- recipes

/** A shared datalist of the project's tag names, for tag fields. */
HmiDialogs.tagDatalist = function(project)
{
	var id = 'hmiTagList';
	var list = document.getElementById(id);

	if (list == null)
	{
		list = document.createElement('datalist');
		list.setAttribute('id', id);
		document.body.appendChild(list);
	}

	list.innerText = '';

	for (var i = 0; i < project.tags.length; i++)
	{
		var opt = document.createElement('option');
		opt.setAttribute('value', project.tags[i].name);
		list.appendChild(opt);
	}

	return id;
};

/**
 * HMI > Recipes: the project's Recipe Books. Edits a copy, applied on OK.
 * Each book has a name, its Save/Load tags and, when Upload/Download tags is
 * ticked, an Upload/Download tag paired with each. Recipes saved in the
 * project are the starting recipes a Run uses until the PC has its own.
 */
HmiDialogs.showRecipes = function(ui)
{
	if (ui.hmiProject == null)
	{
		ui.hmiProject = HmiFile.createDefaultProject();
	}

	var project = ui.hmiProject;
	var books = HmiRecipes.copyBooks(project.recipeBooks);
	var current = (books.length > 0) ? books[0] : null;
	var listId = HmiDialogs.tagDatalist(project);

	var div = HmiDialogs.el('div', 'hmiDialog hmiRecipesDialog');
	div.appendChild(HmiDialogs.el('div', 'hmiDialogTitle', 'Recipes'));
	div.appendChild(HmiDialogs.el('div', 'hmiHint',
		'A recipe book lists the tags a recipe holds. Scripts save and load recipes with RecipeSave(book, name) ' +
		'and RecipeLoad(book, name); with Upload/Download tags, RecipeDownload and RecipeUpload copy each tag ' +
		'to and from its pair. Recipes saved while the application runs are kept on that computer.'));

	var body = HmiDialogs.el('div', 'hmiRecipeBooks');
	var left = HmiDialogs.el('div', 'hmiRecipeBookList');
	var right = HmiDialogs.el('div', 'hmiRecipeBookEditor');
	body.appendChild(left);
	body.appendChild(right);
	div.appendChild(body);

	var error = HmiDialogs.el('div', 'hmiError');
	error.setAttribute('data-hmi-field', 'recipeError');
	div.appendChild(error);

	var uniqueName = function(base)
	{
		var name = base;

		for (var n = 2; HmiRecipes.findBook(books, name) != null; n++)
		{
			name = base + ' ' + n;
		}

		return name;
	};

	var renderBooks = function()
	{
		left.innerHTML = '';
		left.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Recipe books'));

		var wrap = HmiDialogs.el('div', 'hmiUserList');
		var table = HmiDialogs.el('table', 'hmiUserTable');
		var tbody = table.appendChild(HmiDialogs.el('tbody'));

		if (books.length === 0)
		{
			var empty = HmiDialogs.el('td', 'hmiEmpty', 'No recipe books.');
			tbody.appendChild(HmiDialogs.el('tr')).appendChild(empty);
		}

		for (var i = 0; i < books.length; i++)
		{
			(function(b)
			{
				var row = HmiDialogs.el('tr', 'hmiUserRow' + ((b === current) ? ' hmiSelected' : ''));
				row.setAttribute('data-hmi-book', b.name);
				row.style.cursor = 'pointer';
				var cell = HmiDialogs.el('td', 'hmiUserName', b.name);

				if (b === current)
				{
					cell.style.fontWeight = '600';
				}

				row.appendChild(cell);
				mxEvent.addListener(row, 'click', function()
				{
					current = b;
					error.innerText = '';
					renderBooks();
					renderEditor();
				});
				tbody.appendChild(row);
			})(books[i]);
		}

		wrap.appendChild(table);
		left.appendChild(wrap);

		var buttons = HmiDialogs.el('div', 'hmiRecipeButtons');
		var add = HmiDialogs.button('Add', function()
		{
			current = HmiRecipes.newBook(uniqueName('Recipes'));
			books.push(current);
			renderBooks();
			renderEditor();
		});
		add.setAttribute('data-hmi-field', 'addBook');
		buttons.appendChild(add);

		var dup = HmiDialogs.button('Duplicate', function()
		{
			if (current != null)
			{
				var copy = HmiRecipes.copyBooks([current])[0];
				copy.name = uniqueName(current.name + ' copy');
				books.push(copy);
				current = copy;
				renderBooks();
				renderEditor();
			}
		});
		buttons.appendChild(dup);

		var del = HmiDialogs.button('Delete', function()
		{
			if (current != null)
			{
				books.splice(mxUtils.indexOf(books, current), 1);
				current = (books.length > 0) ? books[0] : null;
				renderBooks();
				renderEditor();
			}
		});
		del.setAttribute('data-hmi-field', 'deleteBook');
		buttons.appendChild(del);

		var imp = HmiDialogs.button('Import...', function() { importBooks(); });
		imp.setAttribute('data-hmi-field', 'importBooks');
		var exp = HmiDialogs.button('Export...', function() { exportBooks(); });
		exp.setAttribute('data-hmi-field', 'exportBooks');
		buttons.appendChild(imp);
		buttons.appendChild(exp);
		left.appendChild(buttons);
	};

	var tagInput = function(value, onChange, field)
	{
		var input = document.createElement('input');
		input.className = 'hmiInput';
		input.setAttribute('type', 'text');
		input.setAttribute('list', listId);
		input.setAttribute('placeholder', 'tag name');
		input.setAttribute('data-hmi-field', field);
		input.value = value || '';

		var validate = function()
		{
			var bad = input.value !== '' && project.getTag(input.value) == null;
			input.classList.toggle('hmiInvalid', bad);
			input.setAttribute('title', bad ? 'Unknown tag' : '');
		};

		mxEvent.addListener(input, 'input', function()
		{
			onChange(input.value.trim());
			validate();
		});
		validate();

		return input;
	};

	var renderEditor = function()
	{
		right.innerHTML = '';

		if (current == null)
		{
			right.appendChild(HmiDialogs.el('div', 'hmiEmpty', 'Add a recipe book to begin.'));

			return;
		}

		var book = current;
		right.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Book'));

		var name = HmiDialogs.field(right, 'Name', book.name, function() {});
		name.setAttribute('data-hmi-field', 'bookName');
		mxEvent.addListener(name, 'input', function()
		{
			book.name = name.value.trim();
			var row = left.querySelector('tr.hmiSelected td');

			if (row != null)
			{
				row.innerText = book.name;
			}
		});

		var ud = HmiDialogs.field(right, 'Upload/Download tags', book.uploadDownload, function(v)
		{
			book.uploadDownload = v;
			renderEditor();
		}, 'checkbox');
		ud.setAttribute('data-hmi-field', 'uploadDownload');

		right.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Tags'));

		var wrap = HmiDialogs.el('div', 'hmiUserList');
		var table = HmiDialogs.el('table', 'hmiUserTable hmiRecipeTagTable');
		var head = HmiDialogs.el('tr');
		head.appendChild(HmiDialogs.el('th', null, 'Save/Load tag'));

		if (book.uploadDownload)
		{
			head.appendChild(HmiDialogs.el('th', null, 'Upload/Download tag'));
		}

		head.appendChild(HmiDialogs.el('th', 'hmiUserActions', ''));
		table.appendChild(HmiDialogs.el('thead')).appendChild(head);
		var tbody = table.appendChild(HmiDialogs.el('tbody'));

		if (book.items.length === 0)
		{
			var empty = HmiDialogs.el('td', 'hmiEmpty', 'No tags.');
			empty.setAttribute('colspan', book.uploadDownload ? '3' : '2');
			tbody.appendChild(HmiDialogs.el('tr')).appendChild(empty);
		}

		for (var i = 0; i < book.items.length; i++)
		{
			(function(item, index)
			{
				var row = HmiDialogs.el('tr');
				row.setAttribute('data-hmi-item', '' + index);
				row.appendChild(HmiDialogs.el('td')).appendChild(tagInput(item.tag, function(v) { item.tag = v; },
					'itemTag'));

				if (book.uploadDownload)
				{
					row.appendChild(HmiDialogs.el('td')).appendChild(tagInput(item.ioTag, function(v) { item.ioTag = v; },
						'itemIoTag'));
				}

				var actions = row.appendChild(HmiDialogs.el('td', 'hmiUserActions'));
				var up = HmiDialogs.button('▲', function()
				{
					if (index > 0)
					{
						book.items.splice(index - 1, 0, book.items.splice(index, 1)[0]);
						renderEditor();
					}
				});
				up.setAttribute('title', 'Move up');
				var down = HmiDialogs.button('▼', function()
				{
					if (index < book.items.length - 1)
					{
						book.items.splice(index + 1, 0, book.items.splice(index, 1)[0]);
						renderEditor();
					}
				});
				down.setAttribute('title', 'Move down');
				var remove = HmiDialogs.button('Remove', function()
				{
					book.items.splice(index, 1);
					renderEditor();
				});
				remove.setAttribute('data-hmi-field', 'removeItem');
				actions.appendChild(up);
				actions.appendChild(down);
				actions.appendChild(remove);
				tbody.appendChild(row);
			})(book.items[i], i);
		}

		wrap.appendChild(table);
		right.appendChild(wrap);

		var buttons = HmiDialogs.el('div', 'hmiRecipeButtons');
		var addTag = HmiDialogs.button('Add tag', function()
		{
			book.items.push({tag: '', ioTag: ''});
			renderEditor();

			var inputs = right.querySelectorAll('[data-hmi-field="itemTag"]');

			if (inputs.length > 0)
			{
				inputs[inputs.length - 1].focus();
			}
		});
		addTag.setAttribute('data-hmi-field', 'addItem');
		buttons.appendChild(addTag);
		right.appendChild(buttons);

		right.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Starting recipes'));
		right.appendChild(HmiDialogs.el('div', 'hmiHint', 'Used by a Run until the computer has recipes of its own. ' +
			'Recipes come from RecipeSave or RecipeImport while running, or from importing a book.'));

		var names = HmiRecipes.sortedNames(book.recipes);
		var rwrap = HmiDialogs.el('div', 'hmiUserList');
		var rtable = HmiDialogs.el('table', 'hmiUserTable');
		var rbody = rtable.appendChild(HmiDialogs.el('tbody'));

		if (names.length === 0)
		{
			rbody.appendChild(HmiDialogs.el('tr')).appendChild(HmiDialogs.el('td', 'hmiEmpty', 'No starting recipes.'));
		}

		for (var i = 0; i < names.length; i++)
		{
			(function(rname)
			{
				var row = HmiDialogs.el('tr', 'hmiUserRow');
				row.setAttribute('data-hmi-recipe', rname);
				row.appendChild(HmiDialogs.el('td', 'hmiUserName', rname));
				row.appendChild(HmiDialogs.el('td', 'hmiUserLevel',
					Object.keys(book.recipes[rname]).length + ' values'));
				var actions = row.appendChild(HmiDialogs.el('td', 'hmiUserActions'));
				actions.appendChild(HmiDialogs.button('Remove', function()
				{
					delete book.recipes[rname];
					renderEditor();
				}));
				rbody.appendChild(row);
			})(names[i]);
		}

		rwrap.appendChild(rtable);
		right.appendChild(rwrap);
	};

	/** Problems with the books as edited, or null when they can be saved. */
	var check = function()
	{
		var seen = {};

		for (var i = 0; i < books.length; i++)
		{
			var b = books[i];
			b.items = b.items.filter(function(it) { return it.tag || it.ioTag; });

			if (!b.uploadDownload)
			{
				b.items.forEach(function(it) { it.ioTag = ''; });
			}

			var problem = null;

			if (!HmiRecipes.validName(b.name))
			{
				problem = 'A recipe book name has 1 to 64 characters.';
			}
			else if (seen[b.name.toLowerCase()])
			{
				problem = 'There are two recipe books named "' + b.name + '".';
			}
			else
			{
				var problems = HmiRecipes.bookProblems(project, b);

				if (problems.length > 0)
				{
					problem = 'Recipe book "' + b.name + '": ' + problems.join('; ') + '.';
				}
			}

			if (problem != null)
			{
				current = b;
				renderBooks();
				renderEditor();
				error.innerText = problem;

				return problem;
			}

			seen[b.name.toLowerCase()] = true;
		}

		return null;
	};

	var exportBooks = function()
	{
		var text = JSON.stringify({version: 1, recipeBooks: HmiRecipes.copyBooks(books)}, null, 2);

		HmiDialogs.saveTextFile(ui, 'recipe-books.json', text, 'json', function(message)
		{
			error.innerText = (message != null) ? 'The file could not be written: ' + message : '';
		});
	};

	var importBooks = function()
	{
		HmiDialogs.openTextFile(ui, 'json', function(message, text)
		{
			if (message != null)
			{
				error.innerText = 'The file could not be read: ' + message;

				return;
			}

			var found = HmiDialogs.parseRecipeBooks(text);

			if (found.error != null)
			{
				error.innerText = found.error;

				return;
			}

			var replace = found.books.filter(function(b) { return HmiRecipes.findBook(books, b.name) != null; });
			var apply = function()
			{
				for (var i = 0; i < found.books.length; i++)
				{
					var old = HmiRecipes.findBook(books, found.books[i].name);

					if (old != null)
					{
						books[mxUtils.indexOf(books, old)] = found.books[i];
					}
					else
					{
						books.push(found.books[i]);
					}
				}

				current = found.books[0];
				error.innerText = '';
				renderBooks();
				renderEditor();
			};

			if (replace.length > 0)
			{
				HmiDialogs.showRecipeConfirm(ui, 'Import Recipe Books', 'Replace ' + replace.map(function(b)
				{
					return '"' + b.name + '"';
				}).join(', ') + ' with the imported book' + ((replace.length > 1) ? 's' : '') + '?', 'Replace',
				function(yes)
				{
					if (yes)
					{
						apply();
					}
				});
			}
			else
			{
				apply();
			}
		});
	};

	renderBooks();
	renderEditor();

	HmiDialogs.okCancel(ui, div, function()
	{
		if (check() != null)
		{
			return false;
		}

		if (JSON.stringify(books) !== JSON.stringify(project.recipeBooks))
		{
			project.recipeBooks = books;
			project.touch();
			ui.editor.setModified(true);
		}

		return true;
	});

	ui.showDialog(div, 860, 620, true, true);
};

/** {books} or {error} from a recipe book export. */
HmiDialogs.parseRecipeBooks = function(text)
{
	var data;

	try
	{
		data = JSON.parse(text);
	}
	catch (e)
	{
		return {error: 'This file is not a recipe book export (not JSON).'};
	}

	var list = (data != null) ? data.recipeBooks : null;

	if (!Array.isArray(list) || list.length === 0)
	{
		return {error: 'This file has no recipe books.'};
	}

	var books = [];

	for (var i = 0; i < list.length; i++)
	{
		var b = list[i] || {};

		if (!HmiRecipes.validName(b.name))
		{
			return {error: 'Book ' + (i + 1) + ' in the file has no valid name.'};
		}

		var book = HmiRecipes.newBook(b.name.trim());
		book.uploadDownload = b.uploadDownload === true;

		(Array.isArray(b.items) ? b.items : []).forEach(function(it)
		{
			if (it != null && (typeof it.tag === 'string' || typeof it.ioTag === 'string'))
			{
				book.items.push({tag: String(it.tag || ''), ioTag: String(it.ioTag || '')});
			}
		});

		var recipes = (b.recipes != null && typeof b.recipes === 'object') ? b.recipes : {};

		for (var name in recipes)
		{
			if (HmiRecipes.validName(name) && recipes[name] != null && typeof recipes[name] === 'object')
			{
				book.recipes[name] = {};

				for (var tag in recipes[name])
				{
					var v = recipes[name][tag];

					if (typeof v === 'number' || typeof v === 'string')
					{
						book.recipes[name][tag] = v;
					}
				}
			}
		}

		books.push(book);
	}

	return {books: books};
};

/** Saves text to a file the user picks; fn(error or null). */
HmiDialogs.saveTextFile = function(ui, defaultName, text, ext, fn)
{
	if (window.electron == null || typeof window.electron.request !== 'function' || window.electron.hmiWeb)
	{
		HmiRecipes.browserFiles.exportCsv(defaultName.replace(/\.[^.]+$/, ''), text, function(error)
		{
			fn(error || null);
		});

		return;
	}

	window.electron.request({action: 'showSaveDialog', defaultPath: defaultName,
		filters: [{name: ext.toUpperCase() + ' files', extensions: [ext]}]}, function(path)
	{
		if (path == null)
		{
			fn(null);

			return;
		}

		window.electron.request({action: 'writeFile', path: path, data: text, enc: 'utf8'},
			function() { fn(null); }, function(message) { fn(message); });
	}, function(message) { fn(message); });
};

/** Reads a file the user picks; fn(error, text) (both null on cancel). */
HmiDialogs.openTextFile = function(ui, ext, fn)
{
	if (window.electron == null || typeof window.electron.request !== 'function' || window.electron.hmiWeb)
	{
		HmiRecipes.browserFiles.importCsv(function(error, result)
		{
			if (error != null || result != null)
			{
				fn(error, (result != null) ? result.text : null);
			}
		});

		return;
	}

	window.electron.request({action: 'showOpenDialog', filters: [{name: ext.toUpperCase() + ' files', extensions: [ext]}],
		properties: ['openFile']}, function(paths)
	{
		if (paths == null || paths.length === 0)
		{
			return;
		}

		window.electron.request({action: 'readFile', filename: paths[0], encoding: 'utf8'},
			function(text) { fn(null, text); }, function(message) { fn(message); });
	}, function(message) { fn(message); });
};

/** Where a rectangle in target-screen pixels is in the window, in a Run. */
HmiDialogs.screenRect = function(ui, rect)
{
	var rt = ui.hmiRuntime;

	if (rt == null || rt.screen == null)
	{
		return rect;
	}

	var box = rt.screen.getBoundingClientRect();
	var res = rt.project.settings;
	var sx = box.width / res.width;
	var sy = box.height / res.height;

	return {x: box.left + rect.x * sx, y: box.top + rect.y * sy,
		width: (rect.width != null) ? rect.width * sx : null, height: (rect.height != null) ? rect.height * sy : null};
};

/**
 * ShowRecipeSelect(book[, x, y[, w, h]]): the book's recipes in a modal list
 * with Up and Down arrows; done(name) on Select, done('') on Cancel. x, y,
 * w, h are target-screen pixels; by default 40% x 60% of the screen,
 * centered.
 */
HmiDialogs.showRecipeSelect = function(ui, manager, bookName, rect, done)
{
	var names = manager.recipeNames(bookName);
	var res = (ui.hmiProject != null) ? ui.hmiProject.settings : {width: 1024, height: 768};
	var r = {x: null, y: null, width: Math.max(320, res.width * 0.4), height: Math.max(300, res.height * 0.6)};

	if (rect != null)
	{
		r.x = rect.x;
		r.y = rect.y;

		if (rect.width != null)
		{
			r.width = rect.width;
			r.height = rect.height;
		}
	}

	if (r.x == null)
	{
		r.x = (res.width - r.width) / 2;
		r.y = (res.height - r.height) / 2;
	}

	var place = HmiDialogs.screenRect(ui, r);
	var selected = (names.length > 0) ? 0 : -1;
	var finished = false;

	var finish = function(value)
	{
		if (!finished)
		{
			finished = true;
			done(value);
		}
	};

	var div = HmiDialogs.el('div', 'hmiDialog hmiRecipeSelect');
	div.setAttribute('data-hmi-recipe-select', bookName);
	div.appendChild(HmiDialogs.el('div', 'hmiDialogTitle', bookName));

	var body = HmiDialogs.el('div', 'hmiRecipeSelectBody');
	var list = HmiDialogs.el('div', 'hmiRecipeSelectList');
	var arrows = HmiDialogs.el('div', 'hmiRecipeArrows');
	body.appendChild(list);
	body.appendChild(arrows);
	div.appendChild(body);

	var render = function()
	{
		list.innerHTML = '';

		if (names.length === 0)
		{
			list.appendChild(HmiDialogs.el('div', 'hmiRecipeEmpty', 'No recipes.'));
		}

		for (var i = 0; i < names.length; i++)
		{
			(function(index)
			{
				var row = HmiDialogs.el('div', 'hmiRecipeOption' + ((index === selected) ? ' hmiRecipeSelected' : ''),
					names[index]);
				row.setAttribute('data-hmi-recipe', names[index]);
				mxEvent.addListener(row, 'click', function()
				{
					selected = index;
					render();
				});
				mxEvent.addListener(row, 'dblclick', function()
				{
					selected = index;
					select();
				});
				list.appendChild(row);
			})(i);
		}

		var sel = list.querySelector('.hmiRecipeSelected');

		if (sel != null && sel.scrollIntoView != null)
		{
			sel.scrollIntoView({block: 'nearest'});
		}

		ok.disabled = selected < 0;
	};

	var move = function(step)
	{
		if (names.length > 0)
		{
			selected = Math.max(0, Math.min(names.length - 1, selected + step));
			render();
		}
	};

	var up = HmiDialogs.button('▲', function() { move(-1); });
	up.setAttribute('data-hmi-field', 'recipeUp');
	up.setAttribute('title', 'Previous recipe');
	var down = HmiDialogs.button('▼', function() { move(1); });
	down.setAttribute('data-hmi-field', 'recipeDown');
	down.setAttribute('title', 'Next recipe');
	arrows.appendChild(up);
	arrows.appendChild(down);

	var select = function()
	{
		if (selected >= 0)
		{
			finish(names[selected]);
			ui.hideDialog();
		}
	};

	var footer = HmiDialogs.el('div', 'hmiDialogFooter');
	footer.appendChild(HmiDialogs.el('span', 'hmiSpacer'));
	var cancel = HmiDialogs.button(mxResources.get('cancel'), function()
	{
		finish('');
		ui.hideDialog();
	});
	cancel.setAttribute('data-hmi-field', 'recipeCancel');
	footer.appendChild(cancel);
	var ok = HmiDialogs.button('Select', select, true);
	ok.setAttribute('data-hmi-field', 'recipeSelect');
	footer.appendChild(ok);
	div.appendChild(footer);

	mxEvent.addListener(div, 'keydown', function(evt)
	{
		if (evt.keyCode == 38) { move(-1); mxEvent.consume(evt); }
		else if (evt.keyCode == 40) { move(1); mxEvent.consume(evt); }
		else if (evt.keyCode == 13) { select(); mxEvent.consume(evt); }
	});

	render();
	div.setAttribute('tabindex', '0');

	// The rectangle is the window's outer box; a dialog adds 48 px of padding.
	// Closing the window any other way (Escape, the x) is a Cancel
	var outerW = Math.max(260, Math.round(place.width));
	var outerH = Math.max(220, Math.round(place.height));

	ui.showDialog(div, outerW - 48, outerH - 48, true, true, function()
	{
		finish('');
	});

	if (ui.dialog != null && ui.dialog.container != null && rect != null)
	{
		// Dialogs are centered with a transform; a given place replaces it
		var c = ui.dialog.container.style;
		c.transform = 'none';
		c.left = Math.round(place.x) + 'px';
		c.top = Math.round(place.y) + 'px';
	}

	div.focus();
};

/** A Yes/No question for the operator; fn(true) for the action button. */
HmiDialogs.showRecipeConfirm = function(ui, title, question, action, fn)
{
	var answered = false;
	var answer = function(yes)
	{
		if (!answered)
		{
			answered = true;
			fn(yes);
		}
	};

	var div = HmiDialogs.el('div', 'hmiDialog hmiRecipeConfirm');
	div.appendChild(HmiDialogs.el('div', 'hmiDialogTitle', title));
	var body = HmiDialogs.el('div', 'hmiDialogBody hmiDialogBodyPlain');
	body.appendChild(HmiDialogs.el('div', null, question));
	div.appendChild(body);

	var footer = HmiDialogs.el('div', 'hmiDialogFooter');
	footer.appendChild(HmiDialogs.el('span', 'hmiSpacer'));
	var no = HmiDialogs.button('No', function() { answer(false); ui.hideDialog(); });
	no.setAttribute('data-hmi-field', 'confirmNo');
	var yes = HmiDialogs.button(action, function() { answer(true); ui.hideDialog(); }, true);
	yes.setAttribute('data-hmi-field', 'confirmYes');
	footer.appendChild(no);
	footer.appendChild(yes);
	div.appendChild(footer);

	ui.showDialog(div, 440, 180, true, true, function() { answer(false); });
};

HmiDialogs.MAX_RECIPE_ERRORS = 10;

/**
 * A failed script function (recipes, LinkIndirectTag), for the operator.
 * Failures are collected and shown once the running script has finished: in
 * one window, listed, with identical ones counted rather than repeated.
 */
HmiDialogs.queueFunctionError = function(ui, call, message)
{
	var state = HmiDialogs.recipeErrors;

	if (state == null || state.ui !== ui)
	{
		state = HmiDialogs.recipeErrors = {ui: ui, items: [], extra: 0, open: false, scheduled: false};
	}

	var same = null;

	for (var i = 0; i < state.items.length; i++)
	{
		if (state.items[i].call === call && state.items[i].message === message)
		{
			same = state.items[i];
		}
	}

	if (same != null)
	{
		same.count++;
	}
	else if (state.items.length < HmiDialogs.MAX_RECIPE_ERRORS)
	{
		state.items.push({call: call, message: message, count: 1});
	}
	else
	{
		state.extra++;
	}

	if (state.open)
	{
		HmiDialogs.renderRecipeErrors(state);
	}
	else if (!state.scheduled)
	{
		state.scheduled = true;

		window.setTimeout(function()
		{
			HmiDialogs.flushRecipeErrors();
		}, 0);
	}
};

HmiDialogs.queueRecipeError = HmiDialogs.queueFunctionError;

/** The window's title: Recipe Error, Indirect Tag Error, Window Error, or Script Error for a mix. */
HmiDialogs.functionErrorTitle = function(items)
{
	var recipe = 0;
	var indirect = 0;
	var windows = 0;

	for (var i = 0; i < items.length; i++)
	{
		if (/^Recipe|^ShowRecipeSelect/.test(items[i].call || ''))
		{
			recipe++;
		}
		else if (/^LinkIndirectTag/.test(items[i].call || ''))
		{
			indirect++;
		}
		else if (/^ShowWindow/.test(items[i].call || ''))
		{
			windows++;
		}
	}

	return (recipe === items.length) ? 'Recipe Error' :
		((indirect === items.length) ? 'Indirect Tag Error' :
		((windows === items.length) ? 'Window Error' : 'Script Error'));
};

/** Shows queued recipe errors now rather than after the running script. */
HmiDialogs.flushRecipeErrors = function()
{
	var state = HmiDialogs.recipeErrors;

	if (state != null && state.scheduled)
	{
		state.scheduled = false;
		HmiDialogs.showRecipeErrors(state);
	}
};

HmiDialogs.showRecipeErrors = function(state)
{
	var ui = state.ui;
	var div = HmiDialogs.el('div', 'hmiDialog hmiRecipeErrorDialog');
	state.title = HmiDialogs.el('div', 'hmiDialogTitle', HmiDialogs.functionErrorTitle(state.items));
	div.appendChild(state.title);
	var body = HmiDialogs.el('div', 'hmiDialogBody hmiDialogBodyPlain');
	state.list = HmiDialogs.el('ul', 'hmiRecipeErrors');
	state.list.setAttribute('data-hmi-field', 'recipeErrors');
	body.appendChild(state.list);
	div.appendChild(body);

	var footer = HmiDialogs.el('div', 'hmiDialogFooter');
	footer.appendChild(HmiDialogs.el('span', 'hmiSpacer'));
	var ok = HmiDialogs.button(mxResources.get('ok'), function() { ui.hideDialog(); }, true);
	ok.setAttribute('data-hmi-field', 'recipeErrorOk');
	footer.appendChild(ok);
	div.appendChild(footer);

	state.open = true;
	HmiDialogs.renderRecipeErrors(state);

	ui.showDialog(div, 520, 300, true, true, function()
	{
		state.open = false;
		state.items = [];
		state.extra = 0;
		state.list = null;
		state.title = null;
	});
};

HmiDialogs.renderRecipeErrors = function(state)
{
	if (state.list == null)
	{
		return;
	}

	state.list.innerHTML = '';

	if (state.title != null)
	{
		state.title.textContent = HmiDialogs.functionErrorTitle(state.items);
	}

	for (var i = 0; i < state.items.length; i++)
	{
		var item = state.items[i];
		var li = HmiDialogs.el('li');

		if (item.call)
		{
			li.appendChild(HmiDialogs.el('div', 'hmiRecipeErrorCall', item.call +
				((item.count > 1) ? '  (×' + item.count + ')' : '')));
		}

		li.appendChild(HmiDialogs.el('div', null, item.message));
		state.list.appendChild(li);
	}

	if (state.extra > 0)
	{
		state.list.appendChild(HmiDialogs.el('li', null, 'and ' + state.extra + ' more'));
	}
};
