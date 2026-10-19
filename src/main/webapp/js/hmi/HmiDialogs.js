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

	// Made once, so a selected system tag is still the same object after the
	// list is re-rendered (the rows compare by identity)
	this.system = HmiTypes.systemTagList();

	var div = HmiDialogs.el('div', 'hmiDialog');

	div.appendChild(HmiDialogs.el('div', 'hmiDialogTitle',
		mxResources.get('hmiTagDictionary').replace('...', '')));

	// What the last rename changed, which matters because part of it cannot
	// be undone. Hidden until there is something to say.
	this.noteDiv = HmiDialogs.el('div', 'hmiHint');
	this.noteDiv.style.display = 'none';
	this.noteDiv.setAttribute('data-hmi-field', 'tagNote');
	div.appendChild(this.noteDiv);

	var body = HmiDialogs.el('div', 'hmiDialogBody');

	// Left: the list plus its toolbar.
	var left = HmiDialogs.el('div', 'hmiTagListPane');

	var that = this;
	var newSelect = document.createElement('select');
	newSelect.className = 'hmiInput hmiNewTag';
	newSelect.setAttribute('data-hmi-field', 'newTagType');
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

	left.appendChild(newSelect);

	this.filter = document.createElement('input');
	this.filter.className = 'hmiInput';
	this.filter.setAttribute('type', 'text');
	this.filter.setAttribute('placeholder', 'Filter');

	mxEvent.addListener(this.filter, 'input', function() { that.renderList(); });
	left.appendChild(this.filter);

	this.listDiv = HmiDialogs.el('div', 'hmiTagList');
	left.appendChild(this.listDiv);

	var tools = HmiDialogs.el('div', 'hmiTagTools');

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

HmiTagDialog.prototype.setNote = function(text)
{
	if (this.noteDiv == null)
	{
		return;
	}

	this.noteDiv.innerText = (text != null) ? text : '';
	this.noteDiv.style.display = (text != null && text !== '') ? '' : 'none';
};

/**
 * The list: the project's tags and the reserved system tags together.
 *
 * The system tags are shown so that the names the runtime answers are written
 * down somewhere a designer looks, with their types and what each one means.
 * They are not the project's and nothing may write through them, so they are
 * fresh read-only objects rather than anything the project holds.
 */
HmiTagDialog.prototype.visibleTags = function()
{
	var text = this.filter.value.toLowerCase();
	var res = [];
	var all = this.system.concat(this.project.tags);

	for (var i = 0; i < all.length; i++)
	{
		var tag = all[i];

		if (text === '' || tag.name.toLowerCase().indexOf(text) >= 0 ||
			(tag.comment != null && tag.comment.toLowerCase().indexOf(text) >= 0))
		{
			res.push(tag);
		}
	}

	// Sorted for the list only: the project keeps the order it was built in,
	// which is the order the file is written and the CSV exported in.
	res.sort(function(a, b)
	{
		var x = a.name.toLowerCase();
		var y = b.name.toLowerCase();

		return (x < y) ? -1 : ((x > y) ? 1 : 0);
	});

	return res;
};

HmiTagDialog.prototype.renderList = function()
{
	var that = this;
	this.listDiv.innerText = '';

	var tags = this.visibleTags();

	if (tags.length === 0)
	{
		// The system tags are always there, so an empty list is a filter that
		// matched nothing
		this.listDiv.appendChild(HmiDialogs.el('div', 'hmiEmpty',
			(this.filter.value !== '') ? 'No tags match the filter.' :
				'No tags defined.'));

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
	row.setAttribute('data-hmi-tag', tag.name);

	if (tag.system)
	{
		row.appendChild(HmiDialogs.el('span', 'hmiTagSystem', 'System'));
	}

	mxEvent.addListener(row, 'click', function()
	{
		that.selected = tag;
		that.renderList();
		that.renderForm();
	});

	return row;
};

/**
 * The per-tag property form, shared by the Tag Dictionary and the single tag
 * editor. The host says which tag is being edited and what a change means to
 * it, so the two can differ where they must: the dictionary edits the live
 * tag and renames it in place, the editor edits a draft and keeps the name
 * read-only.
 *
 * host.formDiv                 the container to fill
 * host.project                 the project the tag belongs to
 * host.formTag()               the tag, or null for the empty state
 * host.formChanged()           after any edit
 * host.formRefresh()           re-render the form (and the list, if any)
 * host.formRename(tag, value)  what the Name field commits to
 * host.formNameReadOnly        true to show the name without editing it
 */
HmiTagForm = function() {};

/**
 * A system tag's properties: its name, its type and what it reads, none of
 * them editable.
 *
 * Its own form rather than HmiTagForm.render with every field disabled: that
 * form writes into the tag object it is handed, and a system tag is not a tag
 * the project owns -- there is nothing to write into and nothing to save.
 */
HmiTagForm.renderSystem = function(host)
{
	var tag = host.formTag();
	host.formDiv.innerText = '';

	var show = function(label, value, prop)
	{
		var input = HmiDialogs.field(host.formDiv, label, value, function() {});
		input.setAttribute('readonly', 'readonly');
		input.setAttribute('data-hmi-prop', prop);

		return input;
	};

	show('Name', tag.name, 'name');
	show('Type', tag.type, 'type');
	show('Reads', (tag.comment != null) ? tag.comment : '', 'comment');

	var def = HmiTypes.SYSTEM_TAGS[tag.name];
	var hint = 'A system tag: the runtime supplies it, so it cannot be ' +
		'edited or deleted, and no tag of the dictionary may take its name.';

	if (def != null && !def.readOnly)
	{
		hint += ' A script may write to it.';
	}

	var note = HmiDialogs.el('div', 'hmiHint', hint);
	note.setAttribute('data-hmi-field', 'systemTagNote');
	host.formDiv.appendChild(note);
};

HmiTagForm.render = function(host)
{
	var that = host;
	var tag = host.formTag();
	host.formDiv.innerText = '';

	if (tag == null)
	{
		host.formDiv.appendChild(
			HmiDialogs.el('div', 'hmiEmpty', 'Select a tag, or create one.'));

		return;
	}

	// Renaming is a first-class operation, not an edit to a text field:
	// every expression referencing the old name has to move with it.
	var nameInput = HmiDialogs.field(host.formDiv, 'Name', tag.name,
		function(value)
		{
			that.formRename(tag, value);
		});
	nameInput.setAttribute('data-hmi-prop', 'name');

	if (host.formNameReadOnly)
	{
		nameInput.setAttribute('readonly', 'readonly');
	}

	HmiDialogs.select(host.formDiv, 'Type', tag.type, HmiTypes.TAG_TYPES,
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

			that.formChanged();
			that.formRefresh();
		});

	// Also the alarm's description
	HmiDialogs.field(host.formDiv, 'Comment', tag.comment,
		function(v)
		{
			if (tag.comment !== v)
			{
				tag.comment = v;
				that.formChanged();
			}
		}).setAttribute('data-hmi-prop', 'comment');

	if (HmiTypes.isIndirect(tag.type))
	{
		host.formDiv.appendChild(HmiDialogs.el('div', 'hmiHint',
			'An indirect tag stands for another tag, chosen while the application runs by a script: ' +
			'LinkIndirectTag("' + tag.name + '", "TagName"). Reading or writing it reads or writes that tag. ' +
			'It can be linked to ' + (HmiTypes.isDiscrete(tag.type) ? 'discrete' :
			(HmiTypes.isMessage(tag.type) ? 'message' : 'integer and real')) + ' tags.'));

		return;
	}

	if (HmiTypes.isAnalog(tag.type))
	{
		HmiDialogs.field(host.formDiv, 'Engineering units', tag.engUnits,
			function(v) { tag.engUnits = v; });
		HmiDialogs.field(host.formDiv, 'Initial value', tag.initial,
			function(v) { tag.initial = parseFloat(v) || 0; });
		HmiDialogs.field(host.formDiv, 'Minimum EU', tag.minEU,
			function(v) { tag.minEU = parseFloat(v) || 0; });
		HmiDialogs.field(host.formDiv, 'Maximum EU', tag.maxEU,
			function(v) { tag.maxEU = parseFloat(v) || 0; });
	}
	else if (HmiTypes.isDiscrete(tag.type))
	{
		HmiDialogs.field(host.formDiv, 'Initial value', tag.initial,
			function(v) { tag.initial = (v === '1' || v === 'true') ? 1 : 0; });
		HmiDialogs.field(host.formDiv, 'On message', tag.onMsg,
			function(v) { tag.onMsg = v; });
		HmiDialogs.field(host.formDiv, 'Off message', tag.offMsg,
			function(v) { tag.offMsg = v; });
	}
	else
	{
		HmiDialogs.field(host.formDiv, 'Initial value', tag.initial,
			function(v) { tag.initial = v; });
	}

	if (HmiTypes.isIO(tag.type))
	{
		host.formDiv.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'I/O'));

		var names = [{value: '', label: '(none)'}];

		for (var i = 0; i < host.project.devices.length; i++)
		{
			names.push(host.project.devices[i].name);
		}

		// Keep a device name that no longer exists visible rather than
		// silently blanking the tag's binding.
		if (tag.device && host.project.getDevice(tag.device) == null)
		{
			names.push({value: tag.device, label: tag.device + ' (missing)'});
		}

		HmiDialogs.select(host.formDiv, 'Device', tag.device || '', names, function(v)
		{
			tag.device = v;
			that.formChanged();
			that.formRefresh();
		});

		var device = host.project.getDevice(tag.device);

		if (device != null && device.protocol === 'simulator')
		{
			host.formDiv.appendChild(HmiDialogs.el('div', 'hmiHint',
				'Simulated: the value comes from the simulator, not a device.'));
		}
		else
		{
			var def = (device != null) ? HmiProject.protocol(device.protocol) : null;
			var note = HmiDialogs.el('div', 'hmiAddressNote');
			var address = HmiDialogs.field(host.formDiv, 'Address', tag.address, function(v)
			{
				tag.address = ('' + v).trim();
				that.formChanged();
				HmiDialogs.checkAddress(device, tag, note);
			});

			address.setAttribute('placeholder', (def != null && def.placeholder) ?
				def.placeholder : 'Choose a device first');
			address.setAttribute('data-hmi-prop', 'address');
			host.formDiv.appendChild(note);

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
			HmiDialogs.field(host.formDiv, 'Scale raw values', tag.scaled === true, function(v)
			{
				tag.scaled = !!v;
				that.formChanged();
				that.formRefresh();
			}, 'checkbox').setAttribute('data-hmi-prop', 'scaled');

			if (tag.scaled === true)
			{
				HmiDialogs.field(host.formDiv, 'Minimum raw', tag.minRaw,
					function(v) { tag.minRaw = parseFloat(v) || 0; }).setAttribute('data-hmi-prop', 'minRaw');
				HmiDialogs.field(host.formDiv, 'Maximum raw', tag.maxRaw,
					function(v) { tag.maxRaw = parseFloat(v) || 0; }).setAttribute('data-hmi-prop', 'maxRaw');
				host.formDiv.appendChild(HmiDialogs.el('div', 'hmiHint',
					'Raw minimum to maximum is shown as the engineering minimum to maximum.'));
			}
		}
	}

	// Retentive memory tags keep their last value from one Run to the next
	if (!HmiTypes.isIO(tag.type))
	{
		HmiDialogs.field(host.formDiv, 'Retentive', tag.retentive === true, function(v)
		{
			if (v) { tag.retentive = true; }
			else { delete tag.retentive; }

			that.formChanged();
		}, 'checkbox').setAttribute('data-hmi-prop', 'retentive');

		host.formDiv.appendChild(HmiDialogs.el('div', 'hmiHint',
			'Keeps the last value: the next Run starts from it instead of the initial value.'));
	}

	// The tag's comment is the alarm's description
	if (HmiTypes.isAnalog(tag.type))
	{
		host.formDiv.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Alarms'));

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

						that.formChanged();
					}).setAttribute('data-hmi-prop', 'alarm.' + key);
			})(limits[i][0]);
		}

		host.formDiv.appendChild(HmiDialogs.el('div', 'hmiHint',
			'Leave a limit empty for no alarm there. An alarm clears only once ' +
			'the value is back inside its limit by the deadband.'));
	}
	else if (HmiTypes.isDiscrete(tag.type))
	{
		host.formDiv.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Alarm'));

		HmiDialogs.select(host.formDiv, 'Alarm when',
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

				that.formChanged();
			}).setAttribute('data-hmi-prop', 'alarm.state');
	}

	host.formDiv.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Simulation'));

	if (tag.sim == null)
	{
		tag.sim = {};
	}

	HmiDialogs.select(host.formDiv, 'Mode', tag.sim.mode || '',
		['', 'sine', 'ramp', 'random', 'toggle', 'static'],
		function(v)
		{
			if (v === '') { delete tag.sim.mode; }
			else { tag.sim.mode = v; }

			that.formChanged();
		});

	HmiDialogs.field(host.formDiv, 'Period (ms)', tag.sim.periodMs,
		function(v)
		{
			if (v === '') { delete tag.sim.periodMs; }
			else { tag.sim.periodMs = v; }

			that.formChanged();
		});
};


// The Tag Dictionary's side of the shared form: it edits the live tag, so a
// change is a project change, and a rename moves every reference with it.
HmiTagDialog.prototype.renderForm = function()
{
	if (this.selected != null && this.selected.system)
	{
		HmiTagForm.renderSystem(this);

		return;
	}

	HmiTagForm.render(this);
};

HmiTagDialog.prototype.formTag = function()
{
	return this.selected;
};

HmiTagDialog.prototype.formChanged = function()
{
	this.markModified();
};

HmiTagDialog.prototype.formRefresh = function()
{
	this.renderList();
	this.renderForm();
};

HmiTagDialog.prototype.formRename = function(tag, value)
{
	this.rename(tag, value);
};

HmiTagDialog.prototype.uniqueName = function(base)
{
	return HmiDialogs.uniqueTagName(this.project, base);
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

/** What a system tag is told when something is asked of it that it cannot do. */
HmiTagDialog.prototype.systemNote = function(what)
{
	this.setNote('"' + this.selected.name + '" is a system tag: the runtime ' +
		'supplies it, so it cannot be ' + what + '.');
};

HmiTagDialog.prototype.duplicate = function()
{
	if (this.selected == null)
	{
		return;
	}

	if (this.selected.system)
	{
		this.systemNote('duplicated');

		return;
	}

	var that = this;
	var copy = JSON.parse(JSON.stringify(this.selected));
	// A copy of NewTag is NewTag1, a copy of that is NewTag2
	copy.name = HmiDialogs.nextName(this.selected.name, function(name)
	{
		return that.project.getTag(name) != null;
	});
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

	if (this.selected.system)
	{
		this.systemNote('deleted');

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
		this.ui.confirm('"' + name + '" is used in ' + refs.length +
			' place' + ((refs.length == 1) ? '' : 's') +
			' in this project. Delete it anyway?', proceed);
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

	if (!HmiTagRefs.validName(next))
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
	var done = HmiTagDialog.rewriteReferences(this.ui, previous, next);

	delete this.project.tagIndex[previous.toLowerCase()];
	tag.name = next;
	this.project.tagIndex[next.toLowerCase()] = tag;

	this.markModified();
	this.renderList();
	this.renderForm();
	this.setNote(HmiTagDialog.renameNote(previous, next, done));

	if (done.sites > 0)
	{
		HmiLog.log('renamed ' + previous + ' to ' + next + ', updated ' +
			done.sites + ' reference' + ((done.sites == 1) ? '' : 's'));
	}
};

/**
 * What a rename changed. Only the current page's cells are model state, so
 * only those come back with one Undo: the rest is the project's own state and
 * the user has to be told, or an Undo looks as though it half worked.
 */
HmiTagDialog.renameNote = function(previous, next, done)
{
	if (done.sites === 0)
	{
		return 'Renamed ' + previous + ' to ' + next + '. Nothing referenced it.';
	}

	var parts = [done.sites + ' reference' + ((done.sites == 1) ? '' : 's') +
		' updated'];

	if (done.pages > 0)
	{
		parts.push('on ' + done.pages + ' other page' +
			((done.pages == 1) ? '' : 's'));
	}

	if (done.project > 0)
	{
		parts.push('including ' + done.project + ' in scripts, recipe books ' +
			'or saved recipes');
	}

	var note = 'Renamed ' + previous + ' to ' + next + ': ' +
		parts.join(', ') + '.';

	if (done.pages > 0 || done.project > 0)
	{
		note += ' Changes outside this page cannot be undone.';
	}

	if (done.skipped.length > 0)
	{
		note += ' ' + done.skipped.length + ' field' +
			((done.skipped.length == 1) ? '' : 's') + ' could not be read and ' +
			'kept the old name; see HMI > Validate Expressions.';
	}

	return note;
};

/**
 * Every site in the project that names a tag. A tag is used from any page,
 * from the window and application scripts and from a recipe book, so the
 * count covers all of them; HmiTagRefs holds the map.
 */
HmiTagDialog.findReferences = function(ui, name)
{
	return HmiTagRefs.findInProject(ui, name);
};

HmiTagDialog.escapeRe = function(text)
{
	return HmiTagRefs.escapeRe(text);
};

/**
 * Points every reference to one tag at another, throughout the project.
 *
 * @returns {Object} HmiTagRefs.rename's report: {sites, cells, pages,
 * project, skipped}.
 */
HmiTagDialog.rewriteReferences = function(ui, from, to)
{
	var map = {};
	map[('' + from).toLowerCase()] = to;

	return HmiTagRefs.rename(ui, map);
};

HmiTagDialog.prototype.markModified = function()
{
	this.project.touch();
	HmiFile.markModified(this.ui);
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

/**
 * The project's tags as CSV. The project's own order, and its tags alone: a
 * system tag has nothing to export and could not be imported back.
 */
HmiTagDialog.prototype.csvText = function()
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

	return rows.join('\n');
};

HmiTagDialog.prototype.exportCsv = function()
{
	this.ui.showDialog(new HmiTextDialog(this.ui, 'Export CSV', this.csvText(),
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

// ----------------------------------------------------- single tag editor

/**
 * One tag's properties, for creating or editing a tag without the whole
 * dictionary: Find/Replace opens it on a double-click.
 *
 * It edits a copy and applies on Save, because it has a Cancel -- the Tag
 * Dictionary edits the live tag and so offers only Close.
 *
 * @param name the tag to edit, or the name to create
 * @param onClose called with {saved, name} once it has closed
 * @param template the tag a new one is replacing, whose properties it starts
 * from
 */
HmiDialogs.showTagEditor = function(ui, name, onClose, template)
{
	if (ui.hmiProject == null)
	{
		ui.hmiProject = HmiFile.createDefaultProject();
	}

	var dlg = new HmiTagEditorDialog(ui, name, onClose, template);
	ui.showDialog(dlg.container, 520, 600, true, false);
	dlg.init();

	return dlg;
};

HmiTagEditorDialog = function(ui, name, onClose, template)
{
	this.ui = ui;
	this.project = ui.hmiProject;
	this.onClose = onClose || function() {};
	this.existing = this.project.getTag(name);
	this.creating = this.existing == null;

	// Creating the tag is itself the edit, so Save starts live; an existing
	// tag starts clean and Save waits for a change.
	this.dirty = this.creating;
	this.formNameReadOnly = !this.creating;
	this.template = (this.creating && template != null &&
		template.name !== name) ? template : null;
	this.draft = (this.creating) ?
		HmiTagRefs.newTagFrom(ui, ('' + name).trim(), this.template) :
		JSON.parse(JSON.stringify(this.existing));

	var div = HmiDialogs.el('div', 'hmiDialog');
	div.appendChild(HmiDialogs.el('div', 'hmiDialogTitle',
		(this.creating ? 'New Tag - ' : 'Tag - ') + this.draft.name));

	if (this.creating)
	{
		div.appendChild(HmiDialogs.el('div', 'hmiHint', '"' + this.draft.name +
			'" is not in the tag dictionary. Fill in its properties and save ' +
			'to create it.' + ((this.template != null) ?
				' It starts as a copy of "' + this.template.name +
				'", without its address.' : '')));
	}
	else
	{
		div.appendChild(HmiDialogs.el('div', 'hmiHint', 'Rename a tag in ' +
			'HMI > Tag Dictionary, which moves every reference with it.'));
	}

	var body = HmiDialogs.el('div', 'hmiDialogBody');
	this.formDiv = HmiDialogs.el('div', 'hmiTagForm');
	this.formDiv.setAttribute('data-hmi-field', 'tagForm');
	body.appendChild(this.formDiv);
	div.appendChild(body);

	this.error = HmiDialogs.el('div', 'hmiError');
	this.error.setAttribute('data-hmi-field', 'tagError');
	div.appendChild(this.error);

	var that = this;
	var footer = HmiDialogs.el('div', 'hmiDialogFooter');

	this.saveButton = HmiDialogs.button('Save', function() { that.save(); }, true);
	this.saveButton.setAttribute('data-hmi-field', 'saveTag');
	footer.appendChild(this.saveButton);
	footer.appendChild(HmiDialogs.el('span', 'hmiSpacer'));

	var discard = HmiDialogs.button('Discard & Close', function()
	{
		that.finish(false);
	});
	discard.setAttribute('data-hmi-field', 'cancelTag');
	footer.appendChild(discard);

	var close = HmiDialogs.button('Close', function() { that.close(); });
	close.setAttribute('data-hmi-field', 'closeTag');
	footer.appendChild(close);

	div.appendChild(footer);

	this.container = div;
};

HmiTagEditorDialog.prototype.init = function()
{
	this.renderForm();
	this.updateSave();
};

HmiTagEditorDialog.prototype.renderForm = function()
{
	HmiTagForm.render(this);
};

HmiTagEditorDialog.prototype.formTag = function()
{
	return this.draft;
};

HmiTagEditorDialog.prototype.formChanged = function()
{
	this.dirty = true;
	this.error.innerText = '';
	this.updateSave();
};

HmiTagEditorDialog.prototype.formRefresh = function()
{
	this.renderForm();
};

/** Only a tag being created can be renamed here: see the dialog's hint. */
HmiTagEditorDialog.prototype.formRename = function(tag, value)
{
	value = ('' + value).trim();

	if (!this.creating || value === '' || value === tag.name)
	{
		this.renderForm();

		return;
	}

	var problem = HmiTagRefs.checkName(null, value);

	if (problem != null)
	{
		this.error.innerText = problem;
		this.renderForm();

		return;
	}

	if (this.project.getTag(value) != null)
	{
		this.error.innerText = 'A tag named "' + value + '" already exists.';
		this.renderForm();

		return;
	}

	tag.name = value;
	this.formChanged();
	this.renderForm();
};

HmiTagEditorDialog.prototype.updateSave = function()
{
	this.saveButton.disabled = !this.dirty;
};

/** Writes the draft into the project. Returns false when it refused. */
HmiTagEditorDialog.prototype.save = function()
{
	var problem = HmiTagRefs.checkName(null, this.draft.name);

	if (this.draft.name === '' || problem != null)
	{
		this.error.innerText = (problem != null) ? problem :
			'The tag needs a name.';

		return false;
	}

	if (this.creating)
	{
		try
		{
			this.project.addTag(this.draft);
		}
		catch (e)
		{
			this.error.innerText = e.message;

			return false;
		}
	}
	else
	{
		// In place, so that anything already holding this tag keeps it.
		for (var key in this.existing)
		{
			if (this.draft[key] === undefined)
			{
				delete this.existing[key];
			}
		}

		for (var k in this.draft)
		{
			this.existing[k] = this.draft[k];
		}
	}

	// The compile cache is keyed on the dictionary's revision: without this
	// every cached expression still says the tag is unknown.
	this.project.touch();
	HmiFile.markModified(this.ui);
	this.dirty = false;
	this.finish(true);

	return true;
};

HmiTagEditorDialog.prototype.close = function()
{
	if (!this.dirty)
	{
		this.finish(false);

		return;
	}

	var that = this;

	HmiDialogs.showSaveConfirm(this.ui, (this.creating) ? 'New Tag' : 'Tag',
		(this.creating) ? 'Create "' + this.draft.name + '" before closing?' :
			'Save the changes to "' + this.draft.name + '" before closing?',
		function(answer)
		{
			if (answer === 'cancel')
			{
				return;
			}

			// After the prompt has closed, or hideDialog would close it
			// instead of this dialog.
			window.setTimeout(function()
			{
				if (answer === 'save')
				{
					that.save();
				}
				else
				{
					that.finish(false);
				}
			}, 0);
		});
};

HmiTagEditorDialog.prototype.finish = function(saved)
{
	this.ui.hideDialog();
	this.onClose({saved: saved === true, name: this.draft.name});
};

/**
 * Save, Discard or Cancel. Dismissing the window means Cancel: a save prompt
 * that threw the work away when it was waved off would be a trap.
 */
HmiDialogs.showSaveConfirm = function(ui, title, question, fn)
{
	var answered = false;
	var answer = function(what)
	{
		if (!answered)
		{
			answered = true;
			fn(what);
		}
	};

	var div = HmiDialogs.el('div', 'hmiDialog hmiRecipeConfirm');
	div.appendChild(HmiDialogs.el('div', 'hmiDialogTitle', title));
	var body = HmiDialogs.el('div', 'hmiDialogBody hmiDialogBodyPlain');
	body.appendChild(HmiDialogs.el('div', null, question));
	div.appendChild(body);

	var footer = HmiDialogs.el('div', 'hmiDialogFooter');
	footer.appendChild(HmiDialogs.el('span', 'hmiSpacer'));

	var cancel = HmiDialogs.button('Cancel', function()
	{
		answer('cancel');
		ui.hideDialog();
	});
	cancel.setAttribute('data-hmi-field', 'confirmCancel');
	footer.appendChild(cancel);

	var discard = HmiDialogs.button('Discard', function()
	{
		answer('discard');
		ui.hideDialog();
	});
	discard.setAttribute('data-hmi-field', 'confirmDiscard');
	footer.appendChild(discard);

	var save = HmiDialogs.button('Save', function()
	{
		answer('save');
		ui.hideDialog();
	}, true);
	save.setAttribute('data-hmi-field', 'confirmSave');
	footer.appendChild(save);

	div.appendChild(footer);

	ui.showDialog(div, 460, 190, true, true, function() { answer('cancel'); });
};

// ------------------------------------------------- find/replace tag refs

/**
 * Edit > Find/Replace Tag References: the tags the current page or the
 * current selection names, each with a replacement of its own.
 *
 * It exists for re-pointing a copied screen at another unit, which otherwise
 * means opening every object in turn. The scope is fixed when it opens, so
 * Apply can only touch what the list shows.
 */
HmiDialogs.showFindReplaceTags = function(ui)
{
	if (ui.hmiProject == null)
	{
		ui.hmiProject = HmiFile.createDefaultProject();
	}

	var dlg = new HmiFindReplaceDialog(ui);
	ui.showDialog(dlg.container, 720, 560, true, false);
	dlg.init();

	return dlg;
};

HmiFindReplaceDialog = function(ui)
{
	this.ui = ui;
	this.project = ui.hmiProject;
	this.scope = HmiTagRefs.scope(ui);
	this.rows = [];
	this.inputs = {};

	var that = this;
	var div = HmiDialogs.el('div', 'hmiDialog');

	div.appendChild(HmiDialogs.el('div', 'hmiDialogTitle',
		mxResources.get('hmiFindReplaceTags').replace('...', '')));

	this.scopeHint = HmiDialogs.el('div', 'hmiHint', this.scopeText());
	this.scopeHint.setAttribute('data-hmi-field', 'scopeHint');
	div.appendChild(this.scopeHint);

	div.appendChild(HmiDialogs.el('div', 'hmiHint', 'Expressions, scripts, ' +
		'color bands, trend pens and the tag names given to LinkIndirectTag ' +
		'and TrendSetPen are all updated. System tags cannot be replaced and ' +
		'are not listed. Double-click a name to create or edit that tag.'));

	var body = HmiDialogs.el('div', 'hmiDialogBody hmiDialogBodyPlain');

	body.appendChild(HmiDialogs.el('div', 'hmiFormSection',
		'Replace text in the tag names'));

	this.findText = HmiDialogs.field(body, 'Find', '', function() {});
	this.findText.setAttribute('data-hmi-field', 'findText');
	this.replaceText = HmiDialogs.field(body, 'Replace with', '', function()
	{
		that.fill();
	});
	this.replaceText.setAttribute('data-hmi-field', 'replaceText');
	this.matchCase = HmiDialogs.field(body, 'Match case', false, function() {},
		'checkbox');
	this.matchCase.setAttribute('data-hmi-field', 'matchCase');

	var tools = HmiDialogs.el('div', 'hmiRecipeButtons');
	var fill = HmiDialogs.button('Fill replacements', function() { that.fill(); });
	fill.setAttribute('data-hmi-field', 'fillAll');
	tools.appendChild(fill);
	var clear = HmiDialogs.button('Clear replacements', function() { that.clear(); });
	clear.setAttribute('data-hmi-field', 'clearAll');
	tools.appendChild(clear);
	body.appendChild(tools);

	body.appendChild(HmiDialogs.el('div', 'hmiFormSection',
		'Tag references in scope'));

	this.listDiv = HmiDialogs.el('div', 'hmiUserList');
	body.appendChild(this.listDiv);
	div.appendChild(body);

	this.message = HmiDialogs.el('div', 'hmiError');
	this.message.setAttribute('data-hmi-field', 'message');
	div.appendChild(this.message);

	var footer = HmiDialogs.el('div', 'hmiDialogFooter');
	var validate = HmiDialogs.button('Validate', function() { that.validate(); });
	validate.setAttribute('data-hmi-field', 'validate');
	footer.appendChild(validate);
	footer.appendChild(HmiDialogs.el('span', 'hmiSpacer'));
	var apply = HmiDialogs.button('Apply', function() { that.apply(); }, true);
	apply.setAttribute('data-hmi-field', 'apply');
	footer.appendChild(apply);
	var close = HmiDialogs.button('Close', function() { ui.hideDialog(); });
	close.setAttribute('data-hmi-field', 'close');
	footer.appendChild(close);
	div.appendChild(footer);

	this.container = div;
};

HmiFindReplaceDialog.prototype.init = function()
{
	this.reload();
};

/** Which objects are in scope, in the words the user needs to hear. */
HmiFindReplaceDialog.prototype.scopeText = function()
{
	if (this.scope.kind === 'selection')
	{
		return 'Replacing in the ' + this.scope.selected + ' selected object' +
			((this.scope.selected == 1) ? '' : 's') +
			' and the objects inside them, on "' + this.scope.pageName + '".';
	}

	return 'Nothing is selected: replacing throughout the window "' +
		this.scope.pageName + '".';
};

HmiFindReplaceDialog.prototype.reload = function()
{
	this.rows = HmiTagRefs.collect(this.project, this.scope,
		this.ui.editor.graph);
	this.renderRows();
};

HmiFindReplaceDialog.prototype.renderRows = function()
{
	var that = this;
	this.listDiv.innerText = '';
	this.inputs = {};

	if (this.rows.length === 0)
	{
		this.listDiv.appendChild(HmiDialogs.el('div', 'hmiEmpty',
			'Nothing here names a tag.'));

		return;
	}

	var table = HmiDialogs.el('table', 'hmiUserTable hmiRefTable');
	var head = HmiDialogs.el('thead');
	var headRow = HmiDialogs.el('tr');
	var columns = ['Tag', 'Uses', 'Replace with', 'Status'];

	for (var c = 0; c < columns.length; c++)
	{
		headRow.appendChild(HmiDialogs.el('th', null, columns[c]));
	}

	head.appendChild(headRow);
	table.appendChild(head);

	var tbody = HmiDialogs.el('tbody');

	for (var i = 0; i < this.rows.length; i++)
	{
		tbody.appendChild(this.createRow(this.rows[i]));
	}

	table.appendChild(tbody);
	this.listDiv.appendChild(table);
};

HmiFindReplaceDialog.prototype.createRow = function(row)
{
	var that = this;
	var tr = HmiDialogs.el('tr', 'hmiUserRow');
	tr.setAttribute('data-hmi-tag', row.name);

	var name = HmiDialogs.el('td', 'hmiUserName', row.name);
	name.setAttribute('data-hmi-field', 'refName');
	name.setAttribute('title', 'Double-click to edit this tag.');
	name.style.cursor = 'pointer';
	mxEvent.addListener(name, 'dblclick', function()
	{
		that.editTag(row.name, row);
	});
	tr.appendChild(name);

	var uses = HmiDialogs.el('td', 'hmiRefUses', '' + row.uses);
	uses.setAttribute('data-hmi-field', 'refUses');
	tr.appendChild(uses);

	var cell = HmiDialogs.el('td');
	var input = document.createElement('input');
	input.className = 'hmiInput';
	input.setAttribute('type', 'text');
	input.setAttribute('list', HmiDialogs.tagDatalist(this.project));
	input.setAttribute('placeholder', 'leave empty to keep ' + row.name);
	input.setAttribute('data-hmi-field', 'replacement');
	input.setAttribute('title', 'Double-click to create or edit this tag.');
	mxEvent.addListener(input, 'input', function()
	{
		that.validateRow(row);
	});
	mxEvent.addListener(input, 'dblclick', function()
	{
		var typed = input.value.trim();

		if (typed !== '')
		{
			that.editTag(typed, row);
		}
	});
	cell.appendChild(input);
	tr.appendChild(cell);
	this.inputs[row.name.toLowerCase()] = input;

	var status = HmiDialogs.el('td', 'hmiRefStatus');
	status.setAttribute('data-hmi-field', 'refStatus');
	tr.appendChild(status);
	row.statusCell = status;

	this.validateRow(row);

	return tr;
};

/** The tag editor, after which the row is checked again. */
HmiFindReplaceDialog.prototype.editTag = function(name, row)
{
	var that = this;

	HmiDialogs.showTagEditor(this.ui, name, function(result)
	{
		HmiDialogs.tagDatalist(that.project);
		that.validateRow(row);

		if (result.saved)
		{
			that.setMessage('Tag "' + result.name + '" saved.', true);
		}
	}, (row != null) ? this.project.getTag(row.name) : null);
};

HmiFindReplaceDialog.prototype.replacementFor = function(row)
{
	var input = this.inputs[row.name.toLowerCase()];

	return (input != null) ? input.value.trim() : '';
};

/**
 * Marks one row: an unknown tag is a note rather than a refusal, because
 * creating it from here is the point of the double-click.
 */
HmiFindReplaceDialog.prototype.validateRow = function(row)
{
	var input = this.inputs[row.name.toLowerCase()];
	var status = row.statusCell;

	if (input == null || status == null)
	{
		return null;
	}

	var value = input.value.trim();
	var problem = HmiTagRefs.checkName(this.project, value);
	var unknown = problem != null && problem.indexOf('No tag named') === 0;

	input.classList.toggle('hmiInvalid', problem != null && !unknown);
	input.setAttribute('title', (problem != null) ? problem :
		'Double-click to create or edit this tag.');
	status.classList.toggle('hmiError', problem != null && !unknown);

	if (value === '')
	{
		status.innerText = (row.known) ? '' :
			((row.runtime) ? 'runtime name' : 'unknown tag');
	}
	else if (unknown)
	{
		status.innerText = 'new tag';
	}
	else if (problem != null)
	{
		status.innerText = problem;
	}
	else
	{
		status.innerText = 'ready';
	}

	return problem;
};

/** The replacements to make: {lower old name: new name}. */
HmiFindReplaceDialog.prototype.map = function()
{
	var map = {};

	for (var i = 0; i < this.rows.length; i++)
	{
		var value = this.replacementFor(this.rows[i]);

		if (value !== '' && value.toLowerCase() !== this.rows[i].name.toLowerCase())
		{
			map[this.rows[i].name.toLowerCase()] = value;
		}
	}

	return map;
};

/** The rows whose replacement cannot be used at all. */
HmiFindReplaceDialog.prototype.badRows = function()
{
	var bad = [];

	for (var i = 0; i < this.rows.length; i++)
	{
		var problem = this.validateRow(this.rows[i]);

		if (problem != null && problem.indexOf('No tag named') !== 0)
		{
			bad.push(this.rows[i]);
		}
	}

	return bad;
};

/**
 * Fills in the replacement of every name containing the find text. A row that
 * does not contain it is left alone, so a name typed by hand survives.
 */
HmiFindReplaceDialog.prototype.fill = function()
{
	var find = this.findText.value;
	var to = this.replaceText.value;

	if (find === '')
	{
		this.setMessage('Type the text to find first.', false);

		return 0;
	}

	var flags = (this.matchCase.checked) ? 'g' : 'gi';
	var re = new RegExp(HmiTagRefs.escapeRe(find), flags);
	var filled = 0;

	for (var i = 0; i < this.rows.length; i++)
	{
		var row = this.rows[i];
		var hit = (this.matchCase.checked) ? row.name.indexOf(find) >= 0 :
			row.name.toLowerCase().indexOf(find.toLowerCase()) >= 0;

		if (!hit)
		{
			continue;
		}

		var input = this.inputs[row.name.toLowerCase()];
		input.value = row.name.replace(re, to);
		filled++;
		this.validateRow(row);
	}

	this.setMessage((filled === 0) ? 'No tag name contains "' + find + '".' :
		'Filled ' + filled + ' replacement' + ((filled == 1) ? '' : 's') + '.',
		filled > 0);

	return filled;
};

HmiFindReplaceDialog.prototype.clear = function()
{
	for (var i = 0; i < this.rows.length; i++)
	{
		this.inputs[this.rows[i].name.toLowerCase()].value = '';
		this.validateRow(this.rows[i]);
	}

	this.setMessage('', true);
};

HmiFindReplaceDialog.prototype.setMessage = function(text, ok)
{
	this.message.innerText = (text != null) ? text : '';
	this.message.className = (ok) ? 'hmiError hmiAddressOk' : 'hmiError';
};

/**
 * What the replacements would break, without making them: each link is
 * checked before and after, and only a problem the project does not already
 * have is worth reporting.
 */
HmiFindReplaceDialog.prototype.problems = function(map)
{
	var graph = this.ui.editor.graph;
	var project = this.project;
	var problems = [];
	var that = this;

	var label = function(key)
	{
		return (HmiTypes.LINKS[key] != null) ? HmiTypes.LINKS[key].label : key;
	};

	for (var i = 0; i < this.scope.cells.length; i++)
	{
		var cell = this.scope.cells[i];
		// A fresh parse, so rewriting it leaves the model alone.
		var links = HmiProject.getCellLinks(graph, cell);
		var before = {};
		var locals = {};

		for (var key in links)
		{
			before[key] = HmiMenus.checkLink(project, links[key], key).join('\n');

			HmiTagRefs.eachField(links[key], {key: key, roles: ['script']},
				function(site)
			{
				var declared = HmiTagRefs.localsIn(site.holder[site.field]);

				for (var name in declared)
				{
					locals[name] = site.path;
				}
			});
		}

		var skipped = [];
		HmiTagRefs.rewriteLinks(links, map, skipped, cell);

		for (var k in links)
		{
			var after = HmiMenus.checkLink(project, links[k], k);

			for (var e = 0; e < after.length; e++)
			{
				if (before[k].indexOf(after[e]) < 0)
				{
					problems.push({page: this.scope.pageName, cell: cell,
						link: label(k), message: after[e]});
				}
			}
		}

		for (var s = 0; s < skipped.length; s++)
		{
			problems.push({page: this.scope.pageName, cell: cell,
				link: label(skipped[s].link),
				message: 'Left unchanged (' + skipped[s].reason + '): ' +
					skipped[s].path});
		}

		// A replacement that is a local variable in the same script would
		// read the local, not the tag, and nothing else would say so.
		for (var old in map)
		{
			var lower = map[old].toLowerCase();

			if (locals[lower] != null)
			{
				problems.push({page: this.scope.pageName, cell: cell,
					link: 'Action Script',
					message: '"' + map[old] + '" is a local variable in ' +
						locals[lower] + ', so the reference would read the ' +
						'variable, not the tag'});
			}
		}
	}

	return problems;
};

HmiFindReplaceDialog.prototype.validate = function()
{
	var bad = this.badRows();

	if (bad.length > 0)
	{
		this.setMessage(bad.length + ' replacement' +
			((bad.length == 1) ? ' is' : 's are') + ' not valid.', false);

		return {bad: bad.length, problems: []};
	}

	var map = this.map();
	var count = 0;

	for (var key in map)
	{
		count++;
	}

	if (count === 0)
	{
		this.setMessage('Nothing to validate: no replacements are filled in.',
			false);

		return {bad: 0, problems: []};
	}

	var problems = this.problems(map);

	if (problems.length === 0)
	{
		this.setMessage('All ' + count + ' replacement' +
			((count == 1) ? ' is' : 's are') + ' valid.', true);
	}
	else
	{
		this.setMessage(problems.length + ' problem' +
			((problems.length == 1) ? '' : 's') + ' with these replacements.',
			false);
		HmiDialogs.showValidation(this.ui, problems);
	}

	return {bad: 0, problems: problems};
};

HmiFindReplaceDialog.prototype.apply = function()
{
	var bad = this.badRows();

	if (bad.length > 0)
	{
		this.setMessage('Fix the ' + bad.length + ' invalid replacement' +
			((bad.length == 1) ? '' : 's') + ', or clear ' +
			((bad.length == 1) ? 'it' : 'them') + '.', false);

		return null;
	}

	var map = this.map();
	var count = 0;

	for (var key in map)
	{
		count++;
	}

	if (count === 0)
	{
		this.setMessage('Nothing to replace: fill in at least one ' +
			'replacement.', false);

		return null;
	}

	var res = HmiTagRefs.apply(this.ui, this.scope, map);

	// The Animation panel still shows the old text otherwise.
	if (this.ui.format != null)
	{
		this.ui.format.refresh();
	}

	var note = 'Replaced ' + res.sites + ' reference' +
		((res.sites == 1) ? '' : 's') + ' on ' + res.cells + ' object' +
		((res.cells == 1) ? '' : 's') + '.';

	if (res.skipped.length > 0)
	{
		note += ' ' + res.skipped.length + ' field' +
			((res.skipped.length == 1) ? '' : 's') + ' could not be read and ' +
			'kept the old name; Validate lists them.';
	}

	HmiLog.log('find/replace tags: ' + note);
	this.reload();
	this.setMessage(note, res.skipped.length === 0);

	return res;
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
		HmiFile.markModified(ui);
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

	// Application scripts run for the whole application, whichever windows show
	var scripts = JSON.parse(JSON.stringify(project.settings.scripts));

	body.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Scripts'));
	body.appendChild(HmiDialogs.el('div', 'hmiHint',
		'On start runs once when the application starts, before its first ' +
		'window opens. While running repeats at the interval below for as ' +
		'long as the application runs. On shutdown runs once as it stops, ' +
		'after its windows close.'));

	var appScript = function(key, label)
	{
		HmiDialogs.scriptArea(body, label, scripts[key], project, function(v)
		{
			scripts[key] = v;
		}, 6).setAttribute('data-hmi-prop', key);
	};

	appScript('onStart', 'On start');
	appScript('whileRunning', 'While running');

	var every = HmiDialogs.field(body, 'Every (ms)', scripts.everyMs, function() {});
	every.setAttribute('data-hmi-prop', 'everyMs');
	every.setAttribute('placeholder', HmiProject.DEFAULT_APP_EVERY_MS);
	mxEvent.addListener(every, 'input', function() { scripts.everyMs = every.value; });

	appScript('onShutdown', 'On shutdown');

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

		if (('' + scripts.everyMs).trim() === '')
		{
			scripts.everyMs = HmiProject.DEFAULT_APP_EVERY_MS;
		}

		var s = project.settings;
		var changed = JSON.stringify(s.scripts) !== JSON.stringify(scripts) ||
			s.width !== w || s.height !== h ||
			s.startup.join('\n') !== ids.join('\n') ||
			rt.windowMode !== windowMode || rt.exit !== exitMode ||
			(sec.autoLogoutMin || 0) !== logout;

		sec.autoLogoutMin = logout;
		s.scripts = scripts;

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
				HmiFile.markModified(ui);
			});
		}

		if (changed)
		{
			project.touch();
			HmiFile.markModified(ui);
			HmiFrame.refresh(ui);
		}

		return true;
	};

	HmiDialogs.okCancel(ui, div, apply);
	ui.showDialog(div, 480, Math.max(600, Math.min(700, window.innerHeight - 60)), true, true);
};

/** "Popup, title bar, 400 \u00D7 300 at 10, 20" */
HmiDialogs.windowSummary = function(w)
{
	var type = {replace: 'Replace', overlay: 'Overlay', popup: 'Popup'}[w.type];

	return type + ((w.titleBar) ? ', title bar' : '') +
		((HmiWindowManager.isMovable(w)) ? ', movable' : '') + ', ' +
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

/**
 * A color swatch and a Default button, for a dialog field whose color may be
 * unset. An unset color is not stored and gets no inline style at Run, so
 * css/hmi.css keeps its say; the swatch shows the built-in color meanwhile,
 * and the button reads Default when nothing is set.
 */
HmiDialogs.colorField = function(ui, parent, label, prop, get, set, fallback)
{
	var row = HmiDialogs.el('div', 'hmiFormRow');
	row.appendChild(HmiDialogs.el('label', 'hmiFormLabel', label));

	var swatch = HmiDialogs.el('div', 'hmiColor');
	swatch.setAttribute('data-hmi-prop', prop);

	var clear = HmiDialogs.button('Default', function()
	{
		set('');
		refresh();
	});
	clear.setAttribute('data-hmi-prop', prop + 'Default');

	var refresh = function()
	{
		var color = get();
		swatch.style.backgroundColor = (color !== '') ? color : fallback;
		clear.style.visibility = (color !== '') ? 'visible' : 'hidden';
	};

	mxEvent.addListener(swatch, 'click', function(evt)
	{
		mxEvent.consume(evt);

		ui.pickColor(get() || fallback, function(color)
		{
			if (mxUtils.isLightDarkColor(color))
			{
				color = mxUtils.getLightDarkColor(color).light;
			}

			set((color == null || color === mxConstants.NONE) ? '' : color);
			refresh();
		}, null, null, true, label);
	});

	row.appendChild(swatch);
	row.appendChild(clear);
	parent.appendChild(row);
	refresh();

	return row;
};

/** Greys a form row out and stops its fields being used. */
HmiDialogs.enableRow = function(row, on)
{
	if (row == null)
	{
		return;
	}

	if (on)
	{
		row.className = row.className.replace(/ ?hmiDisabled/, '');
	}
	else if (row.className.indexOf('hmiDisabled') < 0)
	{
		row.className += ' hmiDisabled';
	}

	var fields = row.querySelectorAll('input, select, button, textarea');

	for (var i = 0; i < fields.length; i++)
	{
		fields[i].disabled = !on;
	}
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

		// Everything the title bar is drawn with, and whether the operator may
		// drag it. They are kept while the bar is off and come back with it.
		var titleRows = [];

		var number = function(label, key, placeholder)
		{
			var input = HmiDialogs.field(fields, label, d[key], function() {},
				'number');
			input.setAttribute('data-hmi-prop', key);

			if (placeholder != null)
			{
				input.setAttribute('placeholder', '' + placeholder);
			}

			mxEvent.addListener(input, 'input', function()
			{
				var n = parseInt(input.value, 10);
				d[key] = (isNaN(n)) ? '' : n;
				update();
			});

			titleRows.push(input.parentNode);

			return input;
		};

		number('Height (px)', 'titleHeight', HmiProject.TITLE_BAR_HEIGHT);

		var fonts = [{value: '', label: 'Default'}];
		var known = (ui.menus != null && ui.menus.defaultFonts != null) ?
			ui.menus.defaultFonts : [];

		for (var i = 0; i < known.length; i++)
		{
			fonts.push({value: known[i], label: known[i]});
		}

		if (d.titleFont !== '' && mxUtils.indexOf(known, d.titleFont) < 0)
		{
			fonts.push({value: d.titleFont, label: d.titleFont});
		}

		var font = HmiDialogs.select(fields, 'Font', d.titleFont, fonts,
			function(v) { d.titleFont = v; });
		font.setAttribute('data-hmi-prop', 'titleFont');
		titleRows.push(font.parentNode);

		number('Font size (px)', 'titleFontSize', HmiProject.TITLE_FONT_SIZE);

		titleRows.push(HmiDialogs.colorField(ui, fields, 'Text color',
			'titleColor', function() { return d.titleColor; },
			function(v) { d.titleColor = v; update(); },
			HmiProject.TITLE_BAR_COLOR));

		titleRows.push(HmiDialogs.colorField(ui, fields, 'Background',
			'titleFill', function() { return d.titleFill; },
			function(v) { d.titleFill = v; update(); },
			HmiProject.TITLE_BAR_FILL));

		var mv = HmiDialogs.field(fields, 'Movable', d.movable, function(v)
		{
			d.movable = v;
		}, 'checkbox');
		mv.setAttribute('data-hmi-prop', 'movable');
		var movableRow = mv.parentNode;

		fields.appendChild(HmiDialogs.el('div', 'hmiHint',
			'An empty font size or color leaves the built-in one. Movable ' +
			'lets the operator move the window at Run by dragging its title ' +
			'bar; it is for popup windows, and the window opens where it is ' +
			'defined every time.'));

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
						update();
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
				var tb = (d.titleBar) ? titleHeight() : 0;
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
		var bar = HmiDialogs.el('div', 'hmiScreenPreviewTitle');
		rect.appendChild(bar);
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

		var titleHeight = function()
		{
			var n = parseInt(d.titleHeight, 10);

			return (!isNaN(n) && n > 0) ? n : HmiProject.TITLE_BAR_HEIGHT;
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
			bar.style.display = (d.titleBar) ? '' : 'none';
			bar.style.height = Math.max(2,
				Math.round(titleHeight() * scale)) + 'px';
			bar.style.backgroundColor = (d.titleFill !== '') ? d.titleFill :
				HmiProject.TITLE_BAR_FILL;

			for (var i = 0; i < titleRows.length; i++)
			{
				HmiDialogs.enableRow(titleRows[i], d.titleBar);
			}

			HmiDialogs.enableRow(movableRow,
				d.titleBar && d.type === 'popup');

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
			HmiFile.markModified(ui);
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
/**
 * A multi-line script field that marks itself when the script does not
 * compile.
 *
 * @param errorsOf optional: how to compile this text instead of as a plain
 * script. A QuickFunction's body passes one, because it has to be compiled
 * with its own arguments in scope, and the argument list changes while the
 * field is open.
 */
HmiDialogs.scriptArea = function(parent, label, value, project, onChange, rows,
	errorsOf)
{
	var row = HmiDialogs.el('div', 'hmiFormRow hmiFormRowTop');
	row.appendChild(HmiDialogs.el('label', 'hmiFormLabel', label));

	var area = document.createElement('textarea');
	area.className = 'hmiInput hmiScript';
	area.setAttribute('rows', '' + (rows || 3));
	area.setAttribute('placeholder', 'QuickScript statements');
	area.value = (value != null) ? value : '';

	var check = function()
	{
		var errors = (area.value === '') ? [] :
			((errorsOf != null) ? errorsOf(area.value) :
				HmiExpr.compile(area.value,
					{project: project, mode: 'script'}).errors);

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

		// Through the runtime rather than straight to the driver, so a system
		// tag (_TimeFormat, _AckAll) is answered and a refusal is shown
		var res = rt.writeField(cfg.tag, value);

		if (res != null && !res.ok)
		{
			error.innerText = res.error;

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

	// The on-screen keys decide the size of the dialog that holds them
	var size = {width: 380, height: 260};

	if (cfg.keypad && cfg.kind === 'analog')
	{
		size = HmiDialogs.keypadSize();
	}
	else if (cfg.keypad && cfg.kind !== 'discrete')
	{
		size = HmiDialogs.withKeyboard(380, HmiDialogs.INPUT_BASE);
	}

	ui.showDialog(div, size.width, size.height, true, true);

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
 * How big an on-screen key is: a finger's target, not a mouse pointer's.
 *
 * css/hmi.css draws the keys (.hmiKeyboardRow button, .hmiKeypad button) and
 * these numbers are what the dialogs around them are sized from, so the two
 * must change together -- the rule the title bar's colors and the alarm
 * objects' colors already follow.
 *
 * The keypad's three columns are wider than a keyboard key to begin with, so
 * there the height and the label are what grow.
 */
HmiDialogs.KEY_W = 104;
HmiDialogs.KEY_H = 74;
HmiDialogs.KEY_GAP = 4;
HmiDialogs.KEYPAD_GAP = 6;

/** The widest keyboard row (1234567890) and how many rows it has. */
HmiDialogs.KEY_COLUMNS = 10;
HmiDialogs.KEYBOARD_ROWS = 5;
HmiDialogs.KEYPAD_ROWS = 5;

/** What a dialog holds besides its keys: fields, the error line, the footer. */
HmiDialogs.INPUT_BASE = 158;
HmiDialogs.KEYPAD_BASE = 285;

/**
 * A dialog size that fits on the screen. A touch panel may be narrower than
 * the keys want, and then the window is as wide as the screen allows and the
 * keys shrink into it (flex, with no minimum width) rather than overflowing.
 */
HmiDialogs.fitsScreen = function(width, height)
{
	var w = width;
	var h = height;

	if (typeof window !== 'undefined')
	{
		if (window.innerWidth > 0)
		{
			w = Math.min(w, window.innerWidth - 60);
		}

		if (window.innerHeight > 0)
		{
			h = Math.min(h, window.innerHeight - 60);
		}
	}

	return {width: w, height: h};
};

/** How wide the widest keyboard row wants to be, inside a dialog's padding. */
HmiDialogs.keyboardWidth = function()
{
	return HmiDialogs.KEY_COLUMNS * HmiDialogs.KEY_W +
		(HmiDialogs.KEY_COLUMNS - 1) * HmiDialogs.KEY_GAP + 24;
};

/** How tall the keyboard itself is: its rows of keys and its top margin. */
HmiDialogs.keyboardKeysHeight = function()
{
	return HmiDialogs.KEYBOARD_ROWS * (HmiDialogs.KEY_H + HmiDialogs.KEY_GAP) + 10;
};

/**
 * What a dialog measures once its keyboard is shown: at least as wide as the
 * keys want, and taller by the keyboard. The three dialogs that offer one
 * (operator input, Login, the User Manager) all ask this.
 */
HmiDialogs.withKeyboard = function(width, height)
{
	return HmiDialogs.fitsScreen(Math.max(width, HmiDialogs.keyboardWidth()),
		height + HmiDialogs.keyboardKeysHeight());
};

/** The dialog size the numeric keypad needs: as wide as it was, and taller. */
HmiDialogs.keypadSize = function()
{
	return HmiDialogs.fitsScreen(380,
		HmiDialogs.KEYPAD_ROWS * (HmiDialogs.KEY_H + HmiDialogs.KEYPAD_GAP) +
			HmiDialogs.KEYPAD_BASE);
};

/**
 * Grows the open dialog to hold a keyboard, or shrinks it back.
 *
 * A modal dialog is sized when it is created, so the Keyboard button in the
 * Login and User Manager dialogs resizes the container itself; Dialog adds 48
 * px of its own padding to the size it was given, and the dialog stays
 * centered because it is placed with a transform.
 */
HmiDialogs.resizeDialog = function(ui, width, height)
{
	var dlg = (ui != null) ? ui.dialog : null;

	if (dlg == null || dlg.container == null)
	{
		return;
	}

	dlg.container.style.width = (width + 48) + 'px';
	dlg.container.style.height = (height + 48) + 'px';
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
				HmiFile.markModified(ui);
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

		// The keys are a touch target, so the dialog grows in both directions
		var size = (show) ? HmiDialogs.withKeyboard(560, 250) :
			{width: 560, height: 250};

		HmiDialogs.resizeDialog(ui, size.width, size.height);
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
		var tall = (security != null) ? 720 : 560;

		footer.appendChild(HmiDialogs.button('Keyboard', function()
		{
			var show = keyboard.style.display === 'none';
			keyboard.style.display = (show) ? '' : 'none';

			var size = (show) ? HmiDialogs.withKeyboard(560, tall) :
				{width: 560, height: tall};

			HmiDialogs.resizeDialog(ui, size.width, size.height);
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
				HmiFile.markModified(ui);
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

// ------------------------------------------------------------ script tools

/**
 * Puts text on the system clipboard, through the app's own helper where there
 * is one. done(true) when it is there.
 */
HmiDialogs.copyText = function(ui, text, done)
{
	done = done || function() {};

	if (ui != null && ui.writeTextToClipboard != null)
	{
		// (text, onError, onDone): the clipboard API needs the window to
		// have the focus, and refuses rather than throwing when it does not
		ui.writeTextToClipboard('' + text, function()
		{
			done(HmiDialogs.copyFallback(text));
		}, function()
		{
			done(true);
		});

		return;
	}

	done(HmiDialogs.copyFallback(text));
};

/** A hidden field and the old copy command, for when the clipboard API will not. */
HmiDialogs.copyFallback = function(text)
{
	var area = document.createElement('textarea');
	area.style.position = 'fixed';
	area.style.left = '-1000px';
	area.value = '' + text;
	document.body.appendChild(area);
	var ok = false;

	try
	{
		// Both ways of copying need the window to have the focus
		window.focus();
		area.select();
		ok = document.execCommand('copy');
	}
	catch (e)
	{
		ok = false;
	}

	document.body.removeChild(area);

	return ok;
};

/**
 * The next name after this one: the number at its end counts up, and a name
 * that ends in no number gets a 1.
 *
 * NewTag becomes NewTag1, NewTag1 becomes NewTag2, and so on past anything
 * already taken. Copying Pump9_Run gives Pump9_Run1, not Pump10_Run: only a
 * number at the very end counts, so the rest of a name is never reinterpreted.
 *
 * @param taken(name) whether something already has that name
 */
HmiDialogs.nextName = function(name, taken)
{
	var match = ('' + name).match(/^(.*?)(\d*)$/);
	var base = match[1];
	var n = (match[2] !== '') ? parseInt(match[2], 10) : 0;
	var next = base + (++n);

	while (taken(next))
	{
		next = base + (++n);
	}

	return next;
};

/** This name when nothing has it, else the next free one after it. */
HmiDialogs.freeName = function(name, taken)
{
	return (!taken(name)) ? name : HmiDialogs.nextName(name, taken);
};

/** A tag name nothing has yet: NewTag, NewTag1, NewTag2, ... */
HmiDialogs.uniqueTagName = function(project, base)
{
	return HmiDialogs.freeName(base, function(name)
	{
		return project != null && project.getTag(name) != null;
	});
};

/**
 * The buttons under a script field: check it now, make a tag it needs, or
 * look one up.
 *
 * Writing a script means knowing what the tags are called, and the dictionary
 * is behind a dialog that cannot be opened from here. These three keep that
 * within reach of the script being written.
 *
 * opts: {ui, project, scope, area, errorsOf, onTagsChanged}
 * - project is where a new tag is created, scope what the script compiles
 *   against (the same object, unless the host edits a draft);
 * - errorsOf(text) returns the compile errors, as HmiDialogs.scriptArea takes;
 * - onTagsChanged() is called after a tag is created, so the host can rebuild
 *   what it shows and check the script again.
 */
HmiDialogs.scriptTools = function(parent, opts)
{
	var ui = opts.ui;
	var row = HmiDialogs.el('div', 'hmiScriptTools');
	var message = HmiDialogs.el('div', 'hmiError');
	message.setAttribute('data-hmi-field', 'scriptMessage');

	var say = function(text, ok)
	{
		message.innerText = (text != null) ? text : '';
		message.className = (ok) ? 'hmiError hmiAddressOk' : 'hmiError';
	};

	var validate = HmiDialogs.button('Validate', function()
	{
		var errors = (opts.area.value !== '') ? opts.errorsOf(opts.area.value) : [];

		if (errors.length === 0)
		{
			say('No problems found.', true);

			return;
		}

		say(errors[0].message + ((errors.length > 1) ? ' (and ' +
			(errors.length - 1) + ' more)' : ''), false);
	});
	validate.setAttribute('data-hmi-field', 'validateScript');
	validate.setAttribute('title', 'Check this script now');
	row.appendChild(validate);

	var newTag = HmiDialogs.button('New Tag...', function()
	{
		var name = HmiDialogs.uniqueTagName(opts.project, 'NewTag');

		HmiDialogs.showTagEditor(ui, name, function(result)
		{
			if (!result.saved)
			{
				return;
			}

			HmiDialogs.tagDatalist(opts.project);

			if (opts.onTagsChanged != null)
			{
				opts.onTagsChanged();
			}

			say('Tag "' + result.name + '" created.', true);
		});
	});
	newTag.setAttribute('data-hmi-field', 'newTag');
	newTag.setAttribute('title', 'Create a tag without leaving this script');
	row.appendChild(newTag);

	var browse = HmiDialogs.button('Browse Tags...', function()
	{
		HmiDialogs.showTagBrowser(ui, opts.project, function(name)
		{
			HmiDialogs.copyText(ui, name, function(ok)
			{
				// Naming it anyway: the engineer can still type it, which is
				// better than a dead end when the clipboard refuses
				say((ok) ? 'Copied "' + name + '" to the clipboard.' :
					'The clipboard could not be reached. The tag is "' +
					name + '".', ok);
			});
		});
	});
	browse.setAttribute('data-hmi-field', 'browseTags');
	browse.setAttribute('title', 'Find a tag and copy its name');
	row.appendChild(browse);

	parent.appendChild(row);
	parent.appendChild(message);

	return {container: row, message: message, say: say};
};

/**
 * The project's tags, to find one and copy its name into a script.
 *
 * It only reads: picking a tag copies its name and leaves the script to the
 * engineer, rather than guessing where in it the name belongs.
 */
HmiDialogs.showTagBrowser = function(ui, project, onPick)
{
	var selected = null;
	var div = HmiDialogs.el('div', 'hmiDialog');
	div.appendChild(HmiDialogs.el('div', 'hmiDialogTitle', 'Browse Tags'));
	div.appendChild(HmiDialogs.el('div', 'hmiHint',
		'Pick a tag to copy its name, then paste it into the script.'));

	var body = HmiDialogs.el('div', 'hmiDialogBody hmiDialogBodyPlain');

	var filter = document.createElement('input');
	filter.className = 'hmiInput';
	filter.setAttribute('type', 'text');
	filter.setAttribute('placeholder', 'Filter');
	filter.setAttribute('data-hmi-field', 'tagFilter');
	body.appendChild(filter);

	var list = HmiDialogs.el('div', 'hmiTagList');
	list.setAttribute('data-hmi-field', 'tagBrowserList');
	body.appendChild(list);
	div.appendChild(body);

	var copy = null;

	var pick = function()
	{
		if (selected == null)
		{
			return;
		}

		ui.hideDialog();
		onPick(selected.name);
	};

	// The reserved names are offered too: a script reads _TimeFormat or
	// _AccessLevel as readily as a tag of the dictionary
	var all = HmiTypes.systemTagList().concat(project.tags);

	var render = function()
	{
		var text = filter.value.toLowerCase();
		list.innerText = '';
		var shown = 0;

		for (var i = 0; i < all.length; i++)
		{
			var tag = all[i];

			if (text !== '' && tag.name.toLowerCase().indexOf(text) < 0 &&
				('' + (tag.comment || '')).toLowerCase().indexOf(text) < 0)
			{
				continue;
			}

			(function(t)
			{
				var row = HmiDialogs.el('div', 'hmiTagRow' +
					((selected === t) ? ' hmiTagRowOn' : ''));
				row.setAttribute('data-hmi-tag', t.name);
				row.appendChild(HmiDialogs.el('span', 'hmiTagName', t.name));
				row.appendChild(HmiDialogs.el('span', 'hmiTagType', t.type));

				if (t.system)
				{
					row.appendChild(HmiDialogs.el('span', 'hmiTagSystem', 'System'));
				}

				mxEvent.addListener(row, 'click', function()
				{
					selected = t;
					copy.disabled = false;
					render();
				});
				mxEvent.addListener(row, 'dblclick', function()
				{
					selected = t;
					pick();
				});

				list.appendChild(row);
				shown++;
			})(tag);
		}

		if (shown === 0)
		{
			list.appendChild(HmiDialogs.el('div', 'hmiEmpty',
				(project.tags.length === 0) ? 'No tags defined.' :
					'No tag matches "' + filter.value + '".'));
		}
	};

	mxEvent.addListener(filter, 'input', function()
	{
		render();
	});

	var footer = HmiDialogs.el('div', 'hmiDialogFooter');
	footer.appendChild(HmiDialogs.el('span', 'hmiSpacer'));

	var close = HmiDialogs.button('Close', function()
	{
		ui.hideDialog();
	});
	close.setAttribute('data-hmi-field', 'closeBrowser');
	footer.appendChild(close);

	copy = HmiDialogs.button('Copy Name', function()
	{
		pick();
	}, true);
	copy.setAttribute('data-hmi-field', 'copyTag');
	copy.disabled = true;
	footer.appendChild(copy);

	div.appendChild(footer);

	render();
	ui.showDialog(div, 420, 480, true, true);
	window.setTimeout(function() { filter.focus(); }, 0);

	return div;
};

// ------------------------------------------------------------ quick functions

/**
 * HMI > QuickFunctions: the functions this project defines. Edits a copy,
 * applied on OK.
 *
 * A function has typed arguments, which its body reads like variables, and
 * gives a value back with Return. One that writes a tag or calls an action
 * function can be called from a script only, which the list says of each.
 */
HmiDialogs.showQuickFunctions = function(ui)
{
	if (ui.hmiProject == null)
	{
		ui.hmiProject = HmiFile.createDefaultProject();
	}

	var project = ui.hmiProject;
	var fns = HmiQuickFn.copy(project.quickFunctions);
	var current = fns[0] || null;

	// The body being typed has to see the draft arguments and the other draft
	// functions; tags still come from the real dictionary.
	var scope = HmiQuickFn.draftScope(project, fns);

	var div = HmiDialogs.el('div', 'hmiDialog hmiQuickFnDialog');
	div.appendChild(HmiDialogs.el('div', 'hmiDialogTitle',
		mxResources.get('hmiQuickFunctions')));
	div.appendChild(HmiDialogs.el('div', 'hmiHint', 'A QuickFunction is ' +
		'called like any other function. Its arguments are read in the body ' +
		'like variables, and Return gives a value back; without a Return it ' +
		'gives 0. One that writes a tag or calls an action function can be ' +
		'used in scripts only.'));

	var body = HmiDialogs.el('div', 'hmiQuickFns');
	var left = HmiDialogs.el('div', 'hmiQuickFnList');
	var right = HmiDialogs.el('div', 'hmiQuickFnEditor');
	body.appendChild(left);
	body.appendChild(right);
	div.appendChild(body);

	var error = HmiDialogs.el('div', 'hmiError');
	error.setAttribute('data-hmi-field', 'quickError');
	div.appendChild(error);

	var taken = function(name)
	{
		return HmiQuickFn.find(fns, name) != null;
	};

	var uniqueName = function(base)
	{
		return HmiDialogs.freeName(base, taken);
	};

	var usage = function(fn)
	{
		var compiled = HmiQuickFn.compile(scope, fn);

		return (compiled.impure) ? 'scripts only' : 'scripts and expressions';
	};

	var renderList = function()
	{
		left.innerText = '';
		left.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'QuickFunctions'));

		var list = HmiDialogs.el('div', 'hmiUserList');
		var table = HmiDialogs.el('table', 'hmiUserTable');
		var tbody = HmiDialogs.el('tbody');

		if (fns.length === 0)
		{
			var empty = HmiDialogs.el('tr');
			empty.appendChild(HmiDialogs.el('td', 'hmiEmpty',
				'No QuickFunctions.'));
			tbody.appendChild(empty);
		}

		for (var i = 0; i < fns.length; i++)
		{
			(function(fn)
			{
				var row = HmiDialogs.el('tr', 'hmiUserRow' +
					((fn === current) ? ' hmiSelected' : ''));
				row.setAttribute('data-hmi-fn', fn.name);
				row.style.cursor = 'pointer';
				row.appendChild(HmiDialogs.el('td', null,
					HmiQuickFn.signature(fn)));
				row.appendChild(HmiDialogs.el('td', 'hmiQuickFnUsage',
					usage(fn)));

				mxEvent.addListener(row, 'click', function()
				{
					current = fn;
					error.innerText = '';
					renderList();
					renderEditor();
				});

				tbody.appendChild(row);
			})(fns[i]);
		}

		table.appendChild(tbody);
		list.appendChild(table);
		left.appendChild(list);

		var buttons = HmiDialogs.el('div', 'hmiQuickFnButtons');

		var add = HmiDialogs.button('Add', function()
		{
			current = HmiQuickFn.newFunction(uniqueName('Function'));
			fns.push(current);
			scope.touch();
			error.innerText = '';
			renderList();
			renderEditor();
		});
		add.setAttribute('data-hmi-field', 'addFunction');
		buttons.appendChild(add);

		var duplicate = HmiDialogs.button('Duplicate', function()
		{
			if (current == null)
			{
				return;
			}

			var copy = HmiQuickFn.copy([current])[0];
			// Scaled, Scaled1, Scaled2, as a duplicated tag counts up
			copy.name = HmiDialogs.nextName(current.name, taken);
			fns.push(copy);
			current = copy;
			scope.touch();
			renderList();
			renderEditor();
		});
		duplicate.setAttribute('data-hmi-field', 'duplicateFunction');
		buttons.appendChild(duplicate);

		var remove = HmiDialogs.button('Delete', function()
		{
			if (current == null)
			{
				return;
			}

			fns.splice(mxUtils.indexOf(fns, current), 1);
			current = fns[0] || null;
			scope.touch();
			error.innerText = '';
			renderList();
			renderEditor();
		});
		remove.setAttribute('data-hmi-field', 'deleteFunction');
		buttons.appendChild(remove);

		left.appendChild(buttons);
	};

	var renderEditor = function()
	{
		right.innerText = '';

		if (current == null)
		{
			right.appendChild(HmiDialogs.el('div', 'hmiEmpty',
				'Add a QuickFunction to begin.'));

			return;
		}

		var fn = current;

		right.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Function'));

		var name = HmiDialogs.field(right, 'Name', fn.name, function() {});
		name.setAttribute('data-hmi-field', 'fnName');
		mxEvent.addListener(name, 'input', function()
		{
			fn.name = name.value.trim();
			scope.touch();
			var cell = left.querySelector('tr.hmiSelected td');

			if (cell != null)
			{
				cell.innerText = HmiQuickFn.signature(fn);
			}
		});

		right.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Arguments'));

		var table = HmiDialogs.el('table', 'hmiUserTable hmiQuickFnArgTable');
		var head = HmiDialogs.el('thead');
		var headRow = HmiDialogs.el('tr');
		headRow.appendChild(HmiDialogs.el('th', null, 'Name'));
		headRow.appendChild(HmiDialogs.el('th', null, 'Type'));
		headRow.appendChild(HmiDialogs.el('th', null, ''));
		head.appendChild(headRow);
		table.appendChild(head);

		var tbody = HmiDialogs.el('tbody');

		if (fn.args.length === 0)
		{
			var empty = HmiDialogs.el('tr');
			var cell = HmiDialogs.el('td', 'hmiEmpty', 'No arguments.');
			cell.setAttribute('colspan', '3');
			empty.appendChild(cell);
			tbody.appendChild(empty);
		}

		for (var i = 0; i < fn.args.length; i++)
		{
			(function(arg, index)
			{
				var row = HmiDialogs.el('tr', 'hmiUserRow');
				row.setAttribute('data-hmi-arg', '' + index);

				var nameCell = HmiDialogs.el('td');
				var argName = document.createElement('input');
				argName.className = 'hmiInput';
				argName.setAttribute('type', 'text');
				argName.setAttribute('data-hmi-field', 'argName');
				argName.value = arg.name;
				mxEvent.addListener(argName, 'input', function()
				{
					arg.name = argName.value.trim();
					scope.touch();
					recheckBody();
					var cell = left.querySelector('tr.hmiSelected td');

					if (cell != null)
					{
						cell.innerText = HmiQuickFn.signature(fn);
					}
				});
				nameCell.appendChild(argName);
				row.appendChild(nameCell);

				var typeCell = HmiDialogs.el('td');
				var type = document.createElement('select');
				type.className = 'hmiInput';
				type.setAttribute('data-hmi-field', 'argType');

				for (var t = 0; t < HmiQuickFn.TYPES.length; t++)
				{
					var option = document.createElement('option');
					option.setAttribute('value', HmiQuickFn.TYPES[t]);
					mxUtils.write(option, HmiQuickFn.TYPES[t]);
					type.appendChild(option);
				}

				type.value = HmiQuickFn.normalizeType(arg.type);
				mxEvent.addListener(type, 'change', function()
				{
					arg.type = type.value;
					scope.touch();
					recheckBody();
				});
				typeCell.appendChild(type);
				row.appendChild(typeCell);

				var actions = HmiDialogs.el('td', 'hmiUserActions');

				var up = HmiDialogs.button('▲', function()
				{
					if (index > 0)
					{
						fn.args.splice(index - 1, 0, fn.args.splice(index, 1)[0]);
						scope.touch();
						renderEditor();
					}
				});
				up.setAttribute('title', 'Move up');
				actions.appendChild(up);

				var down = HmiDialogs.button('▼', function()
				{
					if (index < fn.args.length - 1)
					{
						fn.args.splice(index + 1, 0, fn.args.splice(index, 1)[0]);
						scope.touch();
						renderEditor();
					}
				});
				down.setAttribute('title', 'Move down');
				actions.appendChild(down);

				var remove = HmiDialogs.button('Remove', function()
				{
					fn.args.splice(index, 1);
					scope.touch();
					renderEditor();
				});
				remove.setAttribute('data-hmi-field', 'removeArg');
				actions.appendChild(remove);

				row.appendChild(actions);
				tbody.appendChild(row);
			})(fn.args[i], i);
		}

		table.appendChild(tbody);
		right.appendChild(table);

		var argButtons = HmiDialogs.el('div', 'hmiQuickFnButtons');
		var addArg = HmiDialogs.button('Add argument', function()
		{
			if (fn.args.length >= HmiQuickFn.MAX_ARGS)
			{
				error.innerText = 'A QuickFunction takes at most ' +
					HmiQuickFn.MAX_ARGS + ' arguments.';

				return;
			}

			fn.args.push({name: '', type: 'Analog'});
			scope.touch();
			renderEditor();

			var inputs = right.querySelectorAll('[data-hmi-field="argName"]');

			if (inputs.length > 0)
			{
				inputs[inputs.length - 1].focus();
			}
		});
		addArg.setAttribute('data-hmi-field', 'addArg');
		argButtons.appendChild(addArg);
		right.appendChild(argButtons);

		right.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Script'));

		var area = HmiDialogs.scriptArea(right, 'Body', fn.body, project,
			function(value)
			{
				fn.body = value;
				scope.touch();
				showUsage();
			}, 10, function(text)
			{
				return HmiQuickFn.compileText(scope, fn, text).errors;
			});
		area.setAttribute('data-hmi-field', 'fnBody');

		HmiDialogs.scriptTools(right, {
			ui: ui,
			project: project,
			area: area,
			errorsOf: function(text)
			{
				return HmiQuickFn.compileText(scope, fn, text).errors;
			},
			onTagsChanged: function()
			{
				// The draft keeps its own revision, so a tag created from
				// here only reaches the next compile after this
				scope.touch();
				recheckBody();
			}
		});

		var usageLine = HmiDialogs.el('div', 'hmiHint');
		usageLine.setAttribute('data-hmi-field', 'fnUsage');
		right.appendChild(usageLine);

		function showUsage()
		{
			usageLine.innerText = 'Can be used in: ' + usage(fn) + '.';
			var row = left.querySelector('tr.hmiSelected td.hmiQuickFnUsage');

			if (row != null)
			{
				row.innerText = usage(fn);
			}
		}

		function recheckBody()
		{
			// The arguments changed, so what the body means changed with them
			area.dispatchEvent(new Event('input'));
			showUsage();
		}

		showUsage();
	};

	/** Problems with the functions as edited, or null when they can be saved. */
	var check = function()
	{
		for (var i = 0; i < fns.length; i++)
		{
			var fn = fns[i];
			fn.name = ('' + fn.name).trim();
			fn.args = fn.args.filter(function(arg)
			{
				return ('' + arg.name).trim() !== '';
			});

			for (var a = 0; a < fn.args.length; a++)
			{
				fn.args[a].name = ('' + fn.args[a].name).trim();
				fn.args[a].type = HmiQuickFn.normalizeType(fn.args[a].type);
			}
		}

		scope.touch();

		for (var i = 0; i < fns.length; i++)
		{
			var problem = HmiQuickFn.nameProblem(scope, fns, fns[i]);

			if (problem == null && HmiQuickFn.inCycle(scope, fns[i].name))
			{
				problem = '"' + fns[i].name + '" calls itself, directly or ' +
					'through another QuickFunction.';
			}

			if (problem == null)
			{
				var errors = HmiQuickFn.compile(scope, fns[i]).errors;

				if (errors.length > 0)
				{
					problem = 'In "' + fns[i].name + '": ' + errors[0].message;
				}
			}

			if (problem != null)
			{
				current = fns[i];
				renderList();
				renderEditor();
				error.innerText = problem;

				return problem;
			}
		}

		return null;
	};

	renderList();
	renderEditor();

	HmiDialogs.okCancel(ui, div, function()
	{
		if (check() != null)
		{
			return false;
		}

		if (JSON.stringify(fns) !== JSON.stringify(project.quickFunctions))
		{
			project.quickFunctions = fns;
			// Compiled expressions hold the old functions until this
			project.touch();
			HmiFile.markModified(ui);
		}

		return true;
	});

	ui.showDialog(div, 860, 620, true, true);

	return div;
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
			HmiFile.markModified(ui);
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
	var screen = 0;
	var database = 0;
	var lists = 0;

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
		else if (/^ScreenToPDF/.test(items[i].call || ''))
		{
			screen++;
		}
		else if (/^SQL/.test(items[i].call || ''))
		{
			database++;
		}
		else if (/^List/.test(items[i].call || ''))
		{
			lists++;
		}
	}

	return (recipe === items.length) ? 'Recipe Error' :
		((indirect === items.length) ? 'Indirect Tag Error' :
		((windows === items.length) ? 'Window Error' :
		((screen === items.length) ? 'Screen to PDF Error' :
		((database === items.length) ? 'Database Error' :
		((lists === items.length) ? 'List Error' : 'Script Error')))));
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

// --------------------------------------------------- database (HmiSql.js)

/**
 * HMI > Database: the four things the SQL* script functions name. Four tabs
 * rather than four menu items, because they are one subject and are nearly
 * always edited together.
 *
 * Everything is edited in a copy and applied on OK. A password typed here is
 * still in plain text while the dialog is open, so OK wraps it before the
 * project is written -- which is asynchronous, so this dialog builds its own
 * footer instead of using okCancel.
 */
HmiDialogs.showDatabase = function(ui)
{
	if (ui.hmiProject == null)
	{
		ui.hmiProject = HmiFile.createDefaultProject();
	}

	var project = ui.hmiProject;
	var draft = {
		dataSources: HmiSql.copyList(project.dataSources),
		bindLists: HmiSql.copyList(project.bindLists),
		tableTemplates: HmiSql.copyList(project.tableTemplates),
		queries: HmiSql.copyList(project.queries)
	};

	var listId = HmiDialogs.tagDatalist(project);
	var store = HmiMenus.alarmStore(ui, false);
	var onThisPc = [];

	var TABS = [
		{key: 'dataSources', label: 'Data Sources', one: 'data source', fresh: 'DataSource'},
		{key: 'bindLists', label: 'Bind Lists', one: 'bind list', fresh: 'BindList'},
		{key: 'tableTemplates', label: 'Table Templates', one: 'table template', fresh: 'TableTemplate'},
		{key: 'queries', label: 'Queries', one: 'query', fresh: 'Query'}
	];

	var tab = TABS[0];
	var current = {};

	for (var t = 0; t < TABS.length; t++)
	{
		current[TABS[t].key] = draft[TABS[t].key][0] || null;
	}

	var div = HmiDialogs.el('div', 'hmiDialog hmiSqlDialog');
	div.appendChild(HmiDialogs.el('div', 'hmiDialogTitle', mxResources.get('hmiDatabase')));
	var hint = HmiDialogs.el('div', 'hmiHint');
	div.appendChild(hint);

	var strip = HmiDialogs.el('div', 'hmiSqlTabs');
	div.appendChild(strip);

	var body = HmiDialogs.el('div', 'hmiSqlBody');
	var left = HmiDialogs.el('div', 'hmiSqlList');
	var right = HmiDialogs.el('div', 'hmiSqlEditor');
	body.appendChild(left);
	body.appendChild(right);
	div.appendChild(body);

	var error = HmiDialogs.el('div', 'hmiError');
	error.setAttribute('data-hmi-field', 'sqlError');
	div.appendChild(error);

	var HINTS = {
		dataSources: 'A data source is a database the application can open. SQLConnect names one, and ' +
			'every other SQL function works through the connection it gives back. A password kept here ' +
			'travels with the project and is only obfuscated, not protected; a computer running the ' +
			'application can hold its own instead.',
		bindLists: 'A bind list pairs a tag with a database column. SQLSelect writes the columns into ' +
			'the tags; SQLInsert and SQLUpdate read the tags into the columns.',
		tableTemplates: 'A table template is the shape of a table the application creates for itself ' +
			'with SQLCreateTable. The types are the studio’s own: each database gets whatever it wants.',
		queries: 'A query is a statement kept in the project, so nothing has to be deployed beside the ' +
			'installer. SQLLoadStatement loads one by name, and a ? in it marks a parameter to set first.'
	};

	var listOf = function() { return draft[tab.key]; };
	var selected = function() { return current[tab.key]; };

	var taken = function(name)
	{
		return HmiSql.find(listOf(), name) != null;
	};

	/** What is wrong with the whole draft, or null. Drafts may still be empty. */
	var check = function()
	{
		for (var i = 0; i < TABS.length; i++)
		{
			var key = TABS[i].key;
			var list = draft[key];

			for (var j = 0; j < list.length; j++)
			{
				var problem = (key === 'dataSources') ? HmiSql.dataSourceProblem(list, list[j]) :
					((key === 'bindLists') ? HmiSql.bindListProblem(list, list[j], true) :
					((key === 'tableTemplates') ? HmiSql.templateProblem(list, list[j], true) :
						HmiSql.queryProblem(list, list[j], true)));

				if (problem != null)
				{
					// Show the tab the problem is on, so the message is not
					// about something out of sight
					if (tab.key !== key)
					{
						tab = TABS[i];
						current[key] = list[j];
						render();
					}

					return problem;
				}
			}
		}

		return null;
	};

	var renderTabs = function()
	{
		strip.innerText = '';

		for (var i = 0; i < TABS.length; i++)
		{
			(function(entry)
			{
				var count = draft[entry.key].length;
				var el = HmiDialogs.el('div', 'hmiSqlTab' + ((entry === tab) ? ' hmiSqlTabOn' : ''),
					entry.label + ((count > 0) ? ' (' + count + ')' : ''));
				el.setAttribute('data-hmi-tab', entry.key);
				mxEvent.addListener(el, 'click', function()
				{
					tab = entry;
					error.innerText = '';
					render();
				});
				strip.appendChild(el);
			})(TABS[i]);
		}
	};

	var renderList = function()
	{
		left.innerText = '';
		left.appendChild(HmiDialogs.el('div', 'hmiFormSection', tab.label));

		var wrap = HmiDialogs.el('div', 'hmiUserList');
		var table = HmiDialogs.el('table', 'hmiUserTable');
		var tbody = HmiDialogs.el('tbody');
		var list = listOf();

		if (list.length === 0)
		{
			var empty = HmiDialogs.el('tr');
			empty.appendChild(HmiDialogs.el('td', 'hmiEmpty', 'No ' + tab.label.toLowerCase() + '.'));
			tbody.appendChild(empty);
		}

		for (var i = 0; i < list.length; i++)
		{
			(function(item)
			{
				var row = HmiDialogs.el('tr', 'hmiUserRow' + ((item === selected()) ? ' hmiSelected' : ''));
				row.setAttribute('data-hmi-item', item.name);
				row.style.cursor = 'pointer';
				row.appendChild(HmiDialogs.el('td', 'hmiUserName', item.name || '(unnamed)'));

				if (tab.key === 'dataSources')
				{
					var kind = HmiSql.provider(item.provider);
					row.appendChild(HmiDialogs.el('td', 'hmiQuickFnUsage',
						(kind != null) ? kind.label : item.provider));
				}

				mxEvent.addListener(row, 'click', function()
				{
					current[tab.key] = item;
					error.innerText = '';
					renderList();
					renderEditor();
				});
				tbody.appendChild(row);
			})(list[i]);
		}

		table.appendChild(tbody);
		wrap.appendChild(table);
		left.appendChild(wrap);

		var buttons = HmiDialogs.el('div', 'hmiSqlButtons');

		var add = HmiDialogs.button('Add', function()
		{
			var name = HmiDialogs.freeName(tab.fresh, taken);
			var item = (tab.key === 'dataSources') ? HmiSql.newDataSource(name) :
				((tab.key === 'bindLists') ? HmiSql.newBindList(name) :
				((tab.key === 'tableTemplates') ? HmiSql.newTemplate(name) : HmiSql.newQuery(name)));
			listOf().push(item);
			current[tab.key] = item;
			error.innerText = '';
			render();
		});
		add.setAttribute('data-hmi-field', 'addItem');
		buttons.appendChild(add);

		var duplicate = HmiDialogs.button('Duplicate', function()
		{
			var item = selected();

			if (item == null)
			{
				return;
			}

			var copy = HmiSql.copyList([item])[0];
			// Plant, Plant1, Plant2, as a duplicated tag counts up
			copy.name = HmiDialogs.nextName(item.name, taken);
			// A copy does not inherit the original's password: it is wrapped,
			// and quietly giving another data source the same credentials is
			// not something to do behind the user's back
			if (copy.password)
			{
				copy.password = '';
			}

			listOf().push(copy);
			current[tab.key] = copy;
			error.innerText = '';
			render();
		});
		duplicate.setAttribute('data-hmi-field', 'duplicateItem');
		buttons.appendChild(duplicate);

		var remove = HmiDialogs.button('Delete', function()
		{
			var item = selected();

			if (item == null)
			{
				return;
			}

			listOf().splice(mxUtils.indexOf(listOf(), item), 1);
			current[tab.key] = listOf()[0] || null;
			error.innerText = '';
			render();
		});
		remove.setAttribute('data-hmi-field', 'deleteItem');
		buttons.appendChild(remove);

		left.appendChild(buttons);
	};

	var nameField = function(parent, item)
	{
		var input = HmiDialogs.field(parent, 'Name', item.name, function() {});
		input.setAttribute('data-hmi-field', 'itemName');
		mxEvent.addListener(input, 'input', function()
		{
			item.name = input.value.trim();
			var cell = left.querySelector('tr.hmiSelected td');

			if (cell != null)
			{
				cell.innerText = item.name || '(unnamed)';
			}
		});

		return input;
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

	var cellInput = function(value, onChange, field, placeholder)
	{
		var input = document.createElement('input');
		input.className = 'hmiInput';
		input.setAttribute('type', 'text');
		input.setAttribute('data-hmi-field', field);

		if (placeholder)
		{
			input.setAttribute('placeholder', placeholder);
		}

		input.value = (value != null) ? value : '';
		mxEvent.addListener(input, 'input', function() { onChange(input.value); });

		return input;
	};

	var moveRow = function(rows, index, by)
	{
		var to = index + by;

		if (to >= 0 && to < rows.length)
		{
			rows.splice(to, 0, rows.splice(index, 1)[0]);
			renderEditor();
		}
	};

	var rowActions = function(rows, index)
	{
		var actions = HmiDialogs.el('td', 'hmiUserActions');
		var up = HmiDialogs.button('▲', function() { moveRow(rows, index, -1); });
		up.setAttribute('title', 'Move up');
		var down = HmiDialogs.button('▼', function() { moveRow(rows, index, 1); });
		down.setAttribute('title', 'Move down');
		var remove = HmiDialogs.button('Remove', function()
		{
			rows.splice(index, 1);
			renderEditor();
		});
		remove.setAttribute('data-hmi-field', 'removeRow');
		actions.appendChild(up);
		actions.appendChild(down);
		actions.appendChild(remove);

		return actions;
	};

	var renderDataSource = function(source)
	{
		right.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Data source'));
		nameField(right, source);

		var kind = HmiDialogs.select(right, 'Kind', source.provider, HmiSql.PROVIDERS, function(v)
		{
			source.provider = v;
			renderList();
			renderEditor();
		});
		kind.setAttribute('data-hmi-field', 'provider');

		if (source.provider === 'sqlite')
		{
			var file = HmiDialogs.field(right, 'File name', source.file, function(v)
			{
				source.file = v.trim();
			});
			file.setAttribute('data-hmi-field', 'file');
			file.setAttribute('placeholder', 'batches.db');

			var folder = HmiDialogs.select(right, 'Kept in', HmiSql.normalizeFolder(source.folder),
				HmiSql.FOLDERS, function(v) { source.folder = v; });
			folder.setAttribute('data-hmi-field', 'folder');
			right.appendChild(HmiDialogs.el('div', 'hmiHint',
				'A name, not a path, so the application finds its database on whatever computer it ' +
				'runs on. The file is created when something first writes to it.'));
		}
		else
		{
			var host = HmiDialogs.field(right, 'Server', source.host, function(v) { source.host = v.trim(); });
			host.setAttribute('data-hmi-field', 'host');
			host.setAttribute('placeholder', 'server name or address');

			var port = HmiDialogs.field(right, 'Port', source.port, function(v) { source.port = v.trim(); });
			port.setAttribute('data-hmi-field', 'port');
			port.setAttribute('placeholder', '' + HmiSql.DEFAULT_PORT);

			var database = HmiDialogs.field(right, 'Database', source.database,
				function(v) { source.database = v.trim(); });
			database.setAttribute('data-hmi-field', 'database');

			var user = HmiDialogs.field(right, 'User', source.user, function(v) { source.user = v.trim(); });
			user.setAttribute('data-hmi-field', 'user');

			// A password already held stays out of sight: the field starts
			// empty and the stored one is kept unless something is typed
			var stored = source.password;
			var row = HmiDialogs.el('div', 'hmiFormRow');
			row.appendChild(HmiDialogs.el('label', 'hmiFormLabel', 'Password'));
			var password = document.createElement('input');
			password.className = 'hmiInput';
			password.setAttribute('type', 'password');
			password.setAttribute('data-hmi-field', 'password');
			password.setAttribute('placeholder', (stored) ? '(kept — type to replace)' : '');
			mxEvent.addListener(password, 'input', function()
			{
				// Emptying the field again means "leave it alone", not "throw
				// it away": Clear is what throws it away
				source.password = (password.value === '') ? stored : password.value;
			});
			row.appendChild(password);

			if (stored)
			{
				var clear = HmiDialogs.button('Clear', function()
				{
					stored = '';
					source.password = '';
					renderEditor();
				});
				clear.setAttribute('title', 'Forget the stored password');
				clear.setAttribute('data-hmi-field', 'clearPassword');
				row.appendChild(clear);
			}

			right.appendChild(row);
			right.appendChild(HmiDialogs.el('div', 'hmiHint',
				'A password kept in the project is obfuscated, which keeps it out of plain sight and ' +
				'no more: anyone with the project file and this product can read it back. Leave it ' +
				'empty and give the computer that runs the application its own below.'));

			right.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Connection'));

			var options = source.options || (source.options = {});
			var encrypt = HmiDialogs.field(right, 'Encrypt the connection', options.encrypt === true,
				function(v) { options.encrypt = v; }, 'checkbox');
			encrypt.setAttribute('data-hmi-field', 'encrypt');

			var trust = HmiDialogs.field(right, 'Accept any certificate',
				options.trustServerCertificate !== false,
				function(v) { options.trustServerCertificate = v; }, 'checkbox');
			trust.setAttribute('data-hmi-field', 'trustServerCertificate');

			var legacy = HmiDialogs.field(right, 'Allow older TLS versions', options.legacyTls === true,
				function(v) { options.legacyTls = v; }, 'checkbox');
			legacy.setAttribute('data-hmi-field', 'legacyTls');

			var instance = HmiDialogs.field(right, 'Instance name', options.instanceName,
				function(v) { options.instanceName = v.trim(); });
			instance.setAttribute('data-hmi-field', 'instanceName');

			var timeout = HmiDialogs.field(right, 'Timeout (ms)', source.timeoutMs,
				function(v) { source.timeoutMs = v.trim(); });
			timeout.setAttribute('data-hmi-field', 'timeoutMs');
			timeout.setAttribute('placeholder', '' + HmiSql.DEFAULT_TIMEOUT_MS);

			right.appendChild(HmiDialogs.el('div', 'hmiHint',
				'An older server may offer only TLS versions this computer refuses by default. If a ' +
				'connection fails over the protocol, allow older TLS versions or leave encryption off.'));
		}

		// This computer's own credentials, which win over the project's
		if (store != null && HmiSql.available())
		{
			right.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'On this computer'));

			var here = null;

			for (var i = 0; i < onThisPc.length; i++)
			{
				if (('' + onThisPc[i].name).toLowerCase() === ('' + source.name).toLowerCase())
				{
					here = onThisPc[i];
				}
			}

			var state = HmiDialogs.el('div', 'hmiHint', (here != null) ?
				('This computer uses its own ' + ((here.user) ? 'user "' + here.user + '" and ' : '') +
					'password for "' + source.name + '", instead of the project’s.') :
				'This computer uses the project’s own credentials. Set a password here to keep it ' +
					'out of the project: it stays on this computer and is not published.');
			state.setAttribute('data-hmi-field', 'pcState');
			right.appendChild(state);

			var pcRow = HmiDialogs.el('div', 'hmiFormRow');
			pcRow.appendChild(HmiDialogs.el('label', 'hmiFormLabel', 'This computer'));
			var pcUser = document.createElement('input');
			pcUser.className = 'hmiInput';
			pcUser.setAttribute('type', 'text');
			pcUser.setAttribute('placeholder', 'user (optional)');
			pcUser.setAttribute('data-hmi-field', 'pcUser');
			pcUser.value = (here != null) ? here.user : '';
			var pcPassword = document.createElement('input');
			pcPassword.className = 'hmiInput';
			pcPassword.setAttribute('type', 'password');
			pcPassword.setAttribute('placeholder', (here != null && here.hasPassword) ?
				'(set — type to replace)' : 'password');
			pcPassword.setAttribute('data-hmi-field', 'pcPassword');
			pcRow.appendChild(pcUser);
			pcRow.appendChild(pcPassword);
			right.appendChild(pcRow);

			var pcButtons = HmiDialogs.el('div', 'hmiSqlButtons');
			var set = HmiDialogs.button('Set on this computer', function()
			{
				if (source.name === '')
				{
					error.innerText = 'Name the data source first.';

					return;
				}

				HmiSql.setOverride(store, source.name,
					{user: pcUser.value.trim(), password: pcPassword.value}, function(list)
					{
						onThisPc = list;
						error.innerText = '';
						renderEditor();
					}, function(e)
					{
						error.innerText = e.message;
					});
			});
			set.setAttribute('data-hmi-field', 'setOverride');
			pcButtons.appendChild(set);

			if (here != null)
			{
				var forget = HmiDialogs.button('Use the project’s', function()
				{
					HmiSql.setOverride(store, source.name, null, function(list)
					{
						onThisPc = list;
						renderEditor();
					}, function(e)
					{
						error.innerText = e.message;
					});
				});
				forget.setAttribute('data-hmi-field', 'clearOverride');
				pcButtons.appendChild(forget);
			}

			right.appendChild(pcButtons);
		}

		right.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Test'));

		var result = HmiDialogs.el('div', 'hmiHint', '');
		result.setAttribute('data-hmi-field', 'testResult');

		var testButtons = HmiDialogs.el('div', 'hmiSqlButtons');
		var test = HmiDialogs.button('Test Connection', function()
		{
			var problem = HmiSql.dataSourceProblem(draft.dataSources, source);

			if (problem != null)
			{
				result.innerText = problem;

				return;
			}

			result.innerText = 'Connecting…';
			// The spec carries whatever the password field holds, wrapped or
			// just typed: the main process unwraps only what was wrapped
			HmiSql.probe(source, function(res)
			{
				result.innerText = (res != null && res.ok) ?
					('Connected in ' + Math.round(res.ms) + ' ms. ' + (res.version || '')) :
					('Could not connect: ' + ((res != null) ? res.error : 'no answer'));
			}, function(e)
			{
				result.innerText = 'Could not connect: ' + e.message;
			});
		});
		test.setAttribute('data-hmi-field', 'testConnection');
		testButtons.appendChild(test);
		right.appendChild(testButtons);
		right.appendChild(result);
	};

	var renderBindList = function(bindList)
	{
		right.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Bind list'));
		nameField(right, bindList);

		right.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Tags and columns'));

		var wrap = HmiDialogs.el('div', 'hmiUserList');
		var table = HmiDialogs.el('table', 'hmiUserTable hmiSqlTable hmiSqlBind');
		var head = HmiDialogs.el('thead');
		var headRow = HmiDialogs.el('tr');

		for (var h = 0; h < 5; h++)
		{
			headRow.appendChild(HmiDialogs.el('th', null,
				['Tag', 'Dotfield', 'Column', 'Delimiter', ''][h]));
		}

		head.appendChild(headRow);
		table.appendChild(head);

		var tbody = HmiDialogs.el('tbody');
		var items = bindList.items;

		if (items.length === 0)
		{
			var empty = HmiDialogs.el('tr');
			var cell = HmiDialogs.el('td', 'hmiEmpty', 'No tags yet.');
			cell.setAttribute('colspan', '5');
			empty.appendChild(cell);
			tbody.appendChild(empty);
		}

		for (var i = 0; i < items.length; i++)
		{
			(function(item, index)
			{
				var row = HmiDialogs.el('tr', 'hmiUserRow');
				row.setAttribute('data-hmi-row', '' + index);
				row.appendChild(HmiDialogs.el('td')).appendChild(
					tagInput(item.tag, function(v) { item.tag = v; }, 'rowTag'));
				row.appendChild(HmiDialogs.el('td')).appendChild(
					cellInput(item.field, function(v) { item.field = v.trim(); }, 'rowField', 'none'));
				row.appendChild(HmiDialogs.el('td')).appendChild(
					cellInput(item.column, function(v) { item.column = v.trim(); }, 'rowColumn', 'column name'));
				row.appendChild(HmiDialogs.el('td')).appendChild(
					cellInput(item.delim, function(v) { item.delim = v; }, 'rowDelim', 'none'));
				row.appendChild(rowActions(items, index));
				tbody.appendChild(row);
			})(items[i], i);
		}

		table.appendChild(tbody);
		wrap.appendChild(table);
		right.appendChild(wrap);

		var buttons = HmiDialogs.el('div', 'hmiSqlButtons');
		var add = HmiDialogs.button('Add tag', function()
		{
			items.push(HmiSql.newBindItem());
			renderEditor();
		});
		add.setAttribute('data-hmi-field', 'addRow');
		buttons.appendChild(add);

		var browse = HmiDialogs.button('Browse Tags...', function()
		{
			HmiDialogs.showTagBrowser(ui, project, function(name)
			{
				var item = HmiSql.newBindItem();
				item.tag = name;
				item.column = name;
				items.push(item);
				renderEditor();
			});
		});
		browse.setAttribute('data-hmi-field', 'browseTags');
		buttons.appendChild(browse);
		right.appendChild(buttons);

		right.appendChild(HmiDialogs.el('div', 'hmiHint',
			'The order is the order the columns are written in. A dotfield reads something other than ' +
			'the tag’s value, such as InAlarm. A delimiter is kept for projects brought over from ' +
			'elsewhere and changes nothing: values are sent as parameters, so none of them needs ' +
			'wrapping or quoting.'));
	};

	var renderTemplate = function(template)
	{
		right.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Table template'));
		nameField(right, template);

		right.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Columns'));

		var wrap = HmiDialogs.el('div', 'hmiUserList');
		var table = HmiDialogs.el('table', 'hmiUserTable hmiSqlTable');
		var head = HmiDialogs.el('thead');
		var headRow = HmiDialogs.el('tr');

		for (var h = 0; h < 6; h++)
		{
			headRow.appendChild(HmiDialogs.el('th', null,
				['Column', 'Type', 'Length', 'Index', 'Empty', ''][h]));
		}

		head.appendChild(headRow);
		table.appendChild(head);

		var tbody = HmiDialogs.el('tbody');
		var columns = template.columns;

		if (columns.length === 0)
		{
			var empty = HmiDialogs.el('tr');
			var cell = HmiDialogs.el('td', 'hmiEmpty', 'No columns yet.');
			cell.setAttribute('colspan', '6');
			empty.appendChild(cell);
			tbody.appendChild(empty);
		}

		for (var i = 0; i < columns.length; i++)
		{
			(function(column, index)
			{
				var row = HmiDialogs.el('tr', 'hmiUserRow');
				row.setAttribute('data-hmi-row', '' + index);

				var name = cellInput(column.name, function(v)
				{
					column.name = v.trim();
					warn();
				}, 'columnName', 'column name');
				row.appendChild(HmiDialogs.el('td')).appendChild(name);

				var typeCell = HmiDialogs.el('td');
				var type = document.createElement('select');
				type.className = 'hmiInput';
				type.setAttribute('data-hmi-field', 'columnType');

				for (var k = 0; k < HmiSql.COLUMN_TYPES.length; k++)
				{
					var opt = document.createElement('option');
					opt.setAttribute('value', HmiSql.COLUMN_TYPES[k].value);
					mxUtils.write(opt, HmiSql.COLUMN_TYPES[k].label);

					if (HmiSql.COLUMN_TYPES[k].value === column.type)
					{
						opt.setAttribute('selected', 'selected');
					}

					type.appendChild(opt);
				}

				mxEvent.addListener(type, 'change', function()
				{
					column.type = type.value;
					renderEditor();
				});
				typeCell.appendChild(type);
				row.appendChild(typeCell);

				var shape = HmiSql.columnType(column.type) || {};
				var lengthCell = HmiDialogs.el('td');

				if (shape.length)
				{
					lengthCell.appendChild(cellInput(column.length, function(v)
					{
						column.length = v.trim();
					}, 'columnLength', shape.scale ? 'digits' : 'characters'));

					if (shape.scale)
					{
						lengthCell.appendChild(cellInput(column.scale, function(v)
						{
							column.scale = v.trim();
						}, 'columnScale', 'decimals'));
					}
				}

				row.appendChild(lengthCell);

				var indexCell = HmiDialogs.el('td');
				var index2 = document.createElement('select');
				index2.className = 'hmiInput';
				index2.setAttribute('data-hmi-field', 'columnIndex');

				for (var m = 0; m < HmiSql.INDEX_KINDS.length; m++)
				{
					var iopt = document.createElement('option');
					iopt.setAttribute('value', HmiSql.INDEX_KINDS[m].value);
					mxUtils.write(iopt, HmiSql.INDEX_KINDS[m].label);

					if (HmiSql.INDEX_KINDS[m].value === HmiSql.normalizeIndex(column.index))
					{
						iopt.setAttribute('selected', 'selected');
					}

					index2.appendChild(iopt);
				}

				mxEvent.addListener(index2, 'change', function() { column.index = index2.value; });
				indexCell.appendChild(index2);
				row.appendChild(indexCell);

				var nullCell = HmiDialogs.el('td');
				var allowNull = document.createElement('input');
				allowNull.className = 'hmiCheck';
				allowNull.setAttribute('type', 'checkbox');
				allowNull.setAttribute('data-hmi-field', 'columnAllowNull');
				allowNull.setAttribute('title', 'Allow an empty value');

				if (column.allowNull !== false)
				{
					allowNull.setAttribute('checked', 'checked');
				}

				mxEvent.addListener(allowNull, 'change', function()
				{
					column.allowNull = allowNull.checked;
				});
				nullCell.appendChild(allowNull);
				row.appendChild(nullCell);

				row.appendChild(rowActions(columns, index));
				tbody.appendChild(row);
			})(columns[i], i);
		}

		table.appendChild(tbody);
		wrap.appendChild(table);
		right.appendChild(wrap);

		var buttons = HmiDialogs.el('div', 'hmiSqlButtons');
		var add = HmiDialogs.button('Add column', function()
		{
			columns.push(HmiSql.newColumn());
			renderEditor();
		});
		add.setAttribute('data-hmi-field', 'addRow');
		buttons.appendChild(add);

		var fromBind = HmiDialogs.button('From a bind list...', function()
		{
			HmiDialogs.showBindListPicker(ui, draft.bindLists, function(bindList)
			{
				for (var i = 0; i < bindList.items.length; i++)
				{
					var item = bindList.items[i];
					var column = HmiSql.newColumn();
					column.name = item.column;
					column.type = HmiSql.typeForTag(project, item.tag, item.field);
					columns.push(column);
				}

				renderEditor();
			});
		});
		fromBind.setAttribute('data-hmi-field', 'columnsFromBindList');
		buttons.appendChild(fromBind);
		right.appendChild(buttons);

		var warning = HmiDialogs.el('div', 'hmiHint', '');
		warning.setAttribute('data-hmi-field', 'columnWarning');
		right.appendChild(warning);

		var warn = function()
		{
			var reserved = [];
			var bracketed = [];

			for (var i = 0; i < columns.length; i++)
			{
				var name = columns[i].name;

				if (name === '')
				{
					continue;
				}

				if (HmiSql.isReservedColumn(name))
				{
					reserved.push(name);
				}
				else if (HmiSql.needsBrackets(name))
				{
					bracketed.push(name);
				}
			}

			var notes = [];

			if (reserved.length > 0)
			{
				notes.push(((reserved.length > 1) ? 'These are SQL keywords and some databases refuse ' +
					'them as column names: ' : 'This is a SQL keyword and some databases refuse it as a ' +
					'column name: ') + reserved.join(', ') + '. A slightly different name avoids it.');
			}

			if (bracketed.length > 0)
			{
				notes.push(((bracketed.length > 1) ? 'These need square brackets around them wherever a ' +
					'script names them: ' : 'This needs square brackets around it wherever a script ' +
					'names it: ') + bracketed.join(', ') + '.');
			}

			warning.innerText = notes.join(' ');
		};

		warn();
	};

	var renderQuery = function(query)
	{
		right.appendChild(HmiDialogs.el('div', 'hmiFormSection', 'Query'));
		nameField(right, query);

		var row = HmiDialogs.el('div', 'hmiFormRow hmiFormRowTop');
		row.appendChild(HmiDialogs.el('label', 'hmiFormLabel', 'Statement'));
		var area = document.createElement('textarea');
		area.className = 'hmiInput hmiScript';
		area.setAttribute('rows', '12');
		area.setAttribute('data-hmi-field', 'querySql');
		area.setAttribute('placeholder', 'SELECT BatchName, Target FROM BatchLog WHERE Target > ?');
		area.value = query.sql || '';
		mxEvent.addListener(area, 'input', function() { query.sql = area.value; });
		row.appendChild(area);
		right.appendChild(row);

		right.appendChild(HmiDialogs.el('div', 'hmiHint',
			'This is the database’s own language, not the studio’s, so it is not checked here: ' +
			'the database reports what it does not like when the statement runs. A ? marks a parameter, ' +
			'set with SQLSetParamChar and the others before SQLExecute runs the statement.'));
	};

	var renderEditor = function()
	{
		right.innerText = '';
		var item = selected();

		if (item == null)
		{
			right.appendChild(HmiDialogs.el('div', 'hmiEmpty', 'Add a ' + tab.one + ' to begin.'));

			return;
		}

		if (tab.key === 'dataSources')
		{
			renderDataSource(item);
		}
		else if (tab.key === 'bindLists')
		{
			renderBindList(item);
		}
		else if (tab.key === 'tableTemplates')
		{
			renderTemplate(item);
		}
		else
		{
			renderQuery(item);
		}
	};

	var render = function()
	{
		hint.innerText = HINTS[tab.key];
		renderTabs();
		renderList();
		renderEditor();
	};

	// A footer of its own, because applying has to wrap any password typed
	// here before the project is written, and that goes through the main
	// process
	var footer = HmiDialogs.el('div', 'hmiDialogFooter');
	footer.appendChild(HmiDialogs.el('span', 'hmiSpacer'));
	footer.appendChild(HmiDialogs.button(mxResources.get('cancel'), function()
	{
		ui.hideDialog();
	}));

	var ok = HmiDialogs.button(mxResources.get('ok'), function()
	{
		var problem = check();

		if (problem != null)
		{
			error.innerText = problem;

			return;
		}

		error.innerText = '';

		var applyAndClose = function()
		{
			var changed = false;

			for (var i = 0; i < TABS.length; i++)
			{
				var key = TABS[i].key;

				if (JSON.stringify(draft[key]) !== JSON.stringify(project[key]))
				{
					project[key] = draft[key];
					changed = true;
				}
			}

			if (changed)
			{
				project.touch();
				HmiFile.markModified(ui);
			}

			ui.hideDialog();
		};

		// Only a password typed here has to go to the main process to be
		// wrapped; with nothing to wrap, OK applies straight away
		if (!HmiSql.needsWrapping(draft.dataSources))
		{
			applyAndClose();

			return;
		}

		HmiSql.wrapPasswords(draft.dataSources).then(applyAndClose)['catch'](function(e)
		{
			error.innerText = 'The password could not be stored: ' + e.message;
		});
	}, true);

	ok.className += ' hmiOk';
	footer.appendChild(ok);
	div.appendChild(footer);

	render();

	if (store != null)
	{
		HmiSql.overrides(store, function(list)
		{
			onThisPc = list;
			renderEditor();
		}, function() {});
	}

	ui.showDialog(div, 880, 660, true, true);

	// Returned so the self test can drive it without a host
	return div;
};

/** Picks one of the project's bind lists, for building a table template. */
HmiDialogs.showBindListPicker = function(ui, bindLists, onPick)
{
	var div = HmiDialogs.el('div', 'hmiDialog');
	div.appendChild(HmiDialogs.el('div', 'hmiDialogTitle', 'Columns from a Bind List'));
	div.appendChild(HmiDialogs.el('div', 'hmiHint',
		'Adds a column for every tag in the list, named as the list names it and typed after the tag.'));

	var wrap = HmiDialogs.el('div', 'hmiUserList');
	var table = HmiDialogs.el('table', 'hmiUserTable');
	var tbody = HmiDialogs.el('tbody');

	if (bindLists.length === 0)
	{
		tbody.appendChild(HmiDialogs.el('tr')).appendChild(
			HmiDialogs.el('td', 'hmiEmpty', 'No bind lists yet.'));
	}

	for (var i = 0; i < bindLists.length; i++)
	{
		(function(bindList)
		{
			var row = HmiDialogs.el('tr', 'hmiUserRow');
			row.style.cursor = 'pointer';
			row.setAttribute('data-hmi-bindlist', bindList.name);
			row.appendChild(HmiDialogs.el('td', 'hmiUserName', bindList.name));
			row.appendChild(HmiDialogs.el('td', 'hmiQuickFnUsage',
				bindList.items.length + ((bindList.items.length === 1) ? ' tag' : ' tags')));
			mxEvent.addListener(row, 'click', function()
			{
				ui.hideDialog();
				onPick(bindList);
			});
			tbody.appendChild(row);
		})(bindLists[i]);
	}

	table.appendChild(tbody);
	wrap.appendChild(table);
	div.appendChild(wrap);

	var footer = HmiDialogs.el('div', 'hmiDialogFooter');
	footer.appendChild(HmiDialogs.el('span', 'hmiSpacer'));
	footer.appendChild(HmiDialogs.button(mxResources.get('cancel'), function() { ui.hideDialog(); }));
	div.appendChild(footer);

	ui.showDialog(div, 420, 360, true, true);
};
