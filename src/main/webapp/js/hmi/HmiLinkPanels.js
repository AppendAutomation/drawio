/**
 * Per-link-type configuration UIs for the Animation panel.
 *
 * Registered into HmiFormatPanel.BUILDERS by key, or by "<family>.*" where a
 * whole family shares a shape. Every numeric parameter is an expression field,
 * never a stepper: in this fork a band boundary may legitimately read
 * `Tank_Level.MaxEU * 0.9`, and a numeric spinner would fight that.
 */
(function()
{
	var B = HmiFormatPanel.BUILDERS;

	// ------------------------------------------------------ discrete colour

	function discreteColor(content, cfg)
	{
		this.addRow(content, mxResources.get('hmiExpression'),
			this.createExprField(cfg, 'expr', 'discrete tag or expression'));
		this.addRow(content, mxResources.get('hmiOnColor'),
			this.createColorField(cfg, 'on'));
		this.addRow(content, mxResources.get('hmiOffColor'),
			this.createColorField(cfg, 'off'));
	}

	B['lineColor.discrete'] = discreteColor;
	B['fillColor.discrete'] = discreteColor;
	B['textColor.discrete'] = discreteColor;

	// -------------------------------------------------------- analog colour

	/**
	 * A variable-length band list, deliberately unlike InTouch's fixed
	 * 10-colour/9-breakpoint array. That array had no active-row count, so a
	 * deliberately-black band was indistinguishable from an unused slot; here
	 * the array length is the count and the last band is open-ended.
	 */
	function analogColor(content, cfg)
	{
		var that = this;

		this.addRow(content, mxResources.get('hmiExpression'),
			this.createExprField(cfg, 'expr', 'analog tag or expression'));

		if (cfg.bands == null)
		{
			cfg.bands = [{max: null, color: '#00CC00'}];
		}

		var list = document.createElement('div');
		list.className = 'hmiBands';

		for (var i = 0; i < cfg.bands.length; i++)
		{
			list.appendChild(bandRow.call(this, cfg, i));
		}

		content.appendChild(list);

		var add = document.createElement('button');
		add.className = 'hmiButton';
		mxUtils.write(add, '+ Band');

		mxEvent.addListener(add, 'click', function(evt)
		{
			mxEvent.consume(evt);

			// New bands go above the open-ended terminal band, which must
			// stay last for the runtime's first-match scan to be correct.
			cfg.bands.splice(Math.max(0, cfg.bands.length - 1), 0,
				{max: '0', color: '#CCCC00'});
			that.commit();
		});

		content.appendChild(add);
	}

	function bandRow(cfg, index)
	{
		var that = this;
		var band = cfg.bands[index];
		var last = (index == cfg.bands.length - 1);

		var row = document.createElement('div');
		row.className = 'hmiBandRow';

		row.appendChild(this.createColorField(band, 'color'));

		if (last)
		{
			var span = document.createElement('span');
			span.className = 'hmiBandElse';
			mxUtils.write(span, 'otherwise');
			row.appendChild(span);
		}
		else
		{
			var lt = document.createElement('span');
			lt.className = 'hmiBandOp';
			mxUtils.write(lt, '<');
			row.appendChild(lt);

			row.appendChild(this.createExprField(band, 'max', 'upper limit'));

			var del = document.createElement('span');
			del.className = 'hmiChipRemove';
			mxUtils.write(del, '×');

			mxEvent.addListener(del, 'click', function(evt)
			{
				mxEvent.consume(evt);
				cfg.bands.splice(index, 1);
				that.commit();
			});

			row.appendChild(del);
		}

		return row;
	}

	B['lineColor.analog'] = analogColor;
	B['fillColor.analog'] = analogColor;
	B['textColor.analog'] = analogColor;

	// ----------------------------------------------------------- visibility

	B['visibility'] = function(content, cfg)
	{
		this.addRow(content, mxResources.get('hmiExpression'),
			this.createExprField(cfg, 'expr', 'condition'));
		this.addRow(content, mxResources.get('hmiSense'),
			this.createSelectField(cfg, 'sense', [
				{value: 'visible', label: mxResources.get('hmiVisible')},
				{value: 'invisible', label: mxResources.get('hmiInvisible')}
			]));
	};

	// ---------------------------------------------------------------- blink

	B['blink'] = function(content, cfg)
	{
		var that = this;

		this.addRow(content, mxResources.get('hmiExpression'),
			this.createExprField(cfg, 'expr', 'condition'));
		this.addRow(content, mxResources.get('hmiRate'),
			this.createExprField(cfg, 'rateMs', 'milliseconds'));

		if (cfg.attrs == null)
		{
			cfg.attrs = ['fill'];
		}

		var attrs = [
			{id: 'line', label: 'Line', color: 'line'},
			{id: 'fill', label: 'Fill', color: 'fill'},
			{id: 'text', label: 'Text', color: 'text'}
		];

		for (var i = 0; i < attrs.length; i++)
		{
			blinkAttr.call(this, content, cfg, attrs[i]);
		}

		this.addRow(content, '', this.createCheckField(cfg, 'blank',
			'Blank instead of color'));
	};

	function blinkAttr(content, cfg, attr)
	{
		var that = this;

		var row = document.createElement('div');
		row.className = 'hmiRow hmiRowInline';

		var wrap = document.createElement('label');
		wrap.className = 'hmiCheck';

		var box = document.createElement('input');
		box.setAttribute('type', 'checkbox');

		if (mxUtils.indexOf(cfg.attrs, attr.id) >= 0)
		{
			box.setAttribute('checked', 'checked');
		}

		mxEvent.addListener(box, 'change', function()
		{
			var i = mxUtils.indexOf(cfg.attrs, attr.id);

			if (box.checked && i < 0)
			{
				cfg.attrs.push(attr.id);
			}
			else if (!box.checked && i >= 0)
			{
				cfg.attrs.splice(i, 1);
			}

			that.commit();
		});

		wrap.appendChild(box);
		mxUtils.write(wrap, attr.label);
		row.appendChild(wrap);
		row.appendChild(this.createColorField(cfg, attr.color));
		content.appendChild(row);
	}

	// -------------------------------------------------------- value display

	B['valueDisplay'] = function(content, cfg)
	{
		this.addRow(content, mxResources.get('hmiKind'),
			this.createSelectField(cfg, 'kind', [
				{value: 'analog', label: 'Analog'},
				{value: 'discrete', label: 'Discrete'},
				{value: 'string', label: 'String'}
			]));
		this.addRow(content, mxResources.get('hmiExpression'),
			this.createExprField(cfg, 'expr', 'tag or expression'));

		if (cfg.kind === 'discrete')
		{
			this.addRow(content, 'On text',
				this.createTextField(cfg, 'onText', "tag's On message"));
			this.addRow(content, 'Off text',
				this.createTextField(cfg, 'offText', "tag's Off message"));
		}
		else if (cfg.kind != 'string')
		{
			this.addRow(content, mxResources.get('hmiFormat'),
				this.createTextField(cfg, 'format', 'e.g. 0.0'));
		}

		this.addRow(content, mxResources.get('hmiPrefix'),
			this.createTextField(cfg, 'prefix', 'text before value'));
		this.addRow(content, mxResources.get('hmiSuffix'),
			this.createTextField(cfg, 'suffix', 'text after value'));
	};

	// ----------------------------------------------------------- user input

	B['userInput'] = function(content, cfg)
	{
		this.addRow(content, mxResources.get('hmiKind'),
			this.createSelectField(cfg, 'kind', [
				{value: 'analog', label: 'Analog'},
				{value: 'discrete', label: 'Discrete'},
				{value: 'string', label: 'String'}
			]));
		this.addRow(content, mxResources.get('hmiTag'),
			this.createTagField(cfg, 'tag'));

		if (cfg.kind == 'analog')
		{
			this.addRow(content, mxResources.get('hmiMin'),
				this.createExprField(cfg, 'min', 'no lower limit'));
			this.addRow(content, mxResources.get('hmiMax'),
				this.createExprField(cfg, 'max', 'no upper limit'));
		}

		this.addRow(content, mxResources.get('hmiPrompt'),
			this.createTextField(cfg, 'prompt', 'shown in the entry dialog'));
		this.addRow(content, '', this.createCheckField(cfg, 'keypad',
			'On-screen keypad'));
	};

	// ----------------------------------------------------------- pushbutton

	B['pushbutton'] = function(content, cfg)
	{
		this.addRow(content, mxResources.get('hmiTag'),
			this.createTagField(cfg, 'tag'));
		this.addRow(content, mxResources.get('hmiAction'),
			this.createSelectField(cfg, 'action', [
				{value: 'toggle', label: 'Toggle'},
				{value: 'set', label: 'Set'},
				{value: 'reset', label: 'Reset'},
				{value: 'direct', label: 'Direct (momentary)'}
			]));
		this.addRow(content, mxResources.get('hmiEnableExpr'),
			this.createExprField(cfg, 'enableExpr', 'always enabled'));
	};
})();

/**
 * A tag name field backed by a datalist of the project's tags. Unknown names
 * are flagged rather than rejected, so a screen can be drawn before the
 * dictionary is complete.
 */
HmiFormatPanel.prototype.createTagField = function(cfg, field)
{
	var that = this;
	var project = this.editorUi.hmiProject;

	var input = this.createTextField(cfg, field, 'tag name');

	if (project != null && project.tags.length > 0)
	{
		var id = 'hmiTagList';

		if (document.getElementById(id) == null)
		{
			var list = document.createElement('datalist');
			list.setAttribute('id', id);
			document.body.appendChild(list);
		}

		var list = document.getElementById(id);
		list.innerText = '';

		for (var i = 0; i < project.tags.length; i++)
		{
			var opt = document.createElement('option');
			opt.setAttribute('value', project.tags[i].name);
			list.appendChild(opt);
		}

		input.setAttribute('list', id);
	}

	var validate = function()
	{
		var known = project != null && project.getTag(input.value) != null;

		if (input.value !== '' && !known)
		{
			input.classList.add('hmiInvalid');
			input.setAttribute('title', 'Unknown tag');
		}
		else
		{
			input.classList.remove('hmiInvalid');
			input.removeAttribute('title');
		}
	};

	mxEvent.addListener(input, 'blur', validate);
	mxEvent.addListener(input, 'input', validate);
	validate();

	return input;
};

/**
 * Milestone 2 link editors.
 *
 * The value/movement family all share one shape -- a driving expression, an
 * input range, and an output range -- so they are generated from the registry
 * rather than written out six times. Every bound is an expression field, which
 * is what lets a bargraph's top track Tank_Level.MaxEU instead of being frozen
 * at design time.
 */
(function()
{
	var B = HmiFormatPanel.BUILDERS;

	var RANGE_LABELS = {
		offsetMin: 'Offset at minimum', offsetMax: 'Offset at maximum',
		pctMin: 'Percent at minimum', pctMax: 'Percent at maximum',
		angleMin: 'Angle at minimum', angleMax: 'Angle at maximum'
	};

	var RANGE_HINTS = {
		offsetMin: 'pixels', offsetMax: 'pixels',
		pctMin: 'percent', pctMax: 'percent',
		angleMin: 'degrees', angleMax: 'degrees'
	};

	function ranged(content, cfg, key, def)
	{
		this.addRow(content, mxResources.get('hmiExpression'),
			this.createExprField(cfg, 'expr', 'analog tag or expression'));
		this.addRow(content, 'Value at minimum',
			this.createExprField(cfg, 'atMin', 'input low'));
		this.addRow(content, 'Value at maximum',
			this.createExprField(cfg, 'atMax', 'input high'));
		this.addRow(content, RANGE_LABELS[def.outMin],
			this.createExprField(cfg, def.outMin, RANGE_HINTS[def.outMin]));
		this.addRow(content, RANGE_LABELS[def.outMax],
			this.createExprField(cfg, def.outMax, RANGE_HINTS[def.outMax]));

		if (key === 'size.height')
		{
			this.addRow(content, 'Grows from',
				this.createSelectField(cfg, 'anchor', [
					{value: 'top', label: 'Top downward'},
					{value: 'bottom', label: 'Bottom upward'},
					{value: 'center', label: 'Centre, both ways'}
				]));
		}
		else if (key === 'size.width')
		{
			this.addRow(content, 'Grows from',
				this.createSelectField(cfg, 'anchor', [
					{value: 'left', label: 'Left rightward'},
					{value: 'right', label: 'Right leftward'},
					{value: 'center', label: 'Centre, both ways'}
				]));
		}
	}

	var movement = ['location.horizontal', 'location.vertical',
		'size.width', 'size.height', 'percentFill.horizontal',
		'percentFill.vertical', 'orientation'];

	for (var i = 0; i < movement.length; i++)
	{
		B[movement[i]] = ranged;
	}

	// ---------------------------------------------------------------- disable

	B['disable'] = function(content, cfg)
	{
		this.addRow(content, mxResources.get('hmiExpression'),
			this.createExprField(cfg, 'expr', 'condition'));

		var note = HmiDialogs.el('div', 'hmiHint',
			'A disabled object ignores touch.');
		content.appendChild(note);
	};

	// ---------------------------------------------------------- alarm colour

	function discreteAlarmColor(content, cfg)
	{
		this.addRow(content, mxResources.get('hmiTag'),
			this.createTagField(cfg, 'tag'));
		this.addRow(content, 'In alarm', this.createColorField(cfg, 'on'));
		this.addRow(content, 'Normal', this.createColorField(cfg, 'off'));
	}

	function analogAlarmColor(content, cfg)
	{
		this.addRow(content, mxResources.get('hmiTag'),
			this.createTagField(cfg, 'tag'));

		var limits = [['loLo', 'LoLo'], ['low', 'Low'], ['normal', 'Normal'],
			['high', 'High'], ['hiHi', 'HiHi']];

		for (var i = 0; i < limits.length; i++)
		{
			this.addRow(content, limits[i][1],
				this.createColorField(cfg, limits[i][0]));
		}

		content.appendChild(HmiDialogs.el('div', 'hmiHint',
			'Limits come from the tag in the dictionary.'));
	}

	B['lineColor.discreteAlarm'] = discreteAlarmColor;
	B['fillColor.discreteAlarm'] = discreteAlarmColor;
	B['textColor.discreteAlarm'] = discreteAlarmColor;
	B['lineColor.analogAlarm'] = analogAlarmColor;
	B['fillColor.analogAlarm'] = analogAlarmColor;
	B['textColor.analogAlarm'] = analogAlarmColor;

	// ---------------------------------------------------------------- slider

	function slider(content, cfg, key)
	{
		this.addRow(content, mxResources.get('hmiTag'),
			this.createTagField(cfg, 'tag'));
		this.addRow(content, 'Value at minimum',
			this.createExprField(cfg, 'atMin', 'value at one end'));
		this.addRow(content, 'Value at maximum',
			this.createExprField(cfg, 'atMax', 'value at the other'));
		this.addRow(content, 'Travel at minimum',
			this.createExprField(cfg, 'travelMin', 'pixels'));
		this.addRow(content, 'Travel at maximum',
			this.createExprField(cfg, 'travelMax', 'pixels'));

		content.appendChild(HmiDialogs.el('div', 'hmiHint',
			'Dragging writes the tag. Add a Location link on the same object ' +
			'to make it move.'));
	}

	B['slider.horizontal'] = slider;
	B['slider.vertical'] = slider;

	// ------------------------------------------------------- window controls

	function windowLink(content, cfg)
	{
		this.addRow(content, 'Window', this.createPageField(cfg, 'window'));
		this.addRow(content, mxResources.get('hmiEnableExpr'),
			this.createExprField(cfg, 'enableExpr', 'always enabled'));
	}

	B['showWindow'] = windowLink;
	B['hideWindow'] = windowLink;

	// --------------------------------------------------------- action script

	B['pushbutton.action'] = function(content, cfg)
	{
		this.addRow(content, 'On down',
			this.createScriptField(cfg, 'onDown'));
		this.addRow(content, 'While down',
			this.createScriptField(cfg, 'whileDown'));
		this.addRow(content, 'Every (ms)',
			this.createExprField(cfg, 'everyMs', 'milliseconds'));
		this.addRow(content, 'On up',
			this.createScriptField(cfg, 'onUp'));
	};
})();

/**
 * A page picker. A "window" in InTouch terms is a page in this fork, so the
 * field offers the pages that actually exist rather than a free-text name that
 * can silently point nowhere.
 */
HmiFormatPanel.prototype.createPageField = function(cfg, field)
{
	var that = this;
	var ui = this.editorUi;
	var options = [{value: '', label: '(none)'}];

	if (ui.pages != null)
	{
		for (var i = 0; i < ui.pages.length; i++)
		{
			var name = (ui.pages[i].getName != null) ?
				ui.pages[i].getName() : ('Page ' + (i + 1));
			options.push({value: name, label: name});
		}
	}

	// Keep a name that no longer matches a page, so renaming a page does not
	// silently discard the link; it shows as unknown instead.
	var known = false;

	for (var i = 0; i < options.length; i++)
	{
		if (options[i].value === cfg[field]) { known = true; }
	}

	if (!known && cfg[field] != null && cfg[field] !== '')
	{
		options.push({value: cfg[field], label: cfg[field] + ' (missing)'});
	}

	return this.createSelectField(cfg, field, options);
};

/**
 * A multi-line script field. Committed on blur rather than per keystroke, so
 * one edit is one undo entry.
 */
HmiFormatPanel.prototype.createScriptField = function(cfg, field)
{
	var that = this;
	var area = document.createElement('textarea');
	area.className = 'hmiInput hmiScript';
	area.setAttribute('rows', '3');
	area.setAttribute('placeholder', 'QuickScript statements');
	area.value = (cfg[field] != null) ? cfg[field] : '';

	var validate = function()
	{
		if (area.value === '')
		{
			area.classList.remove('hmiInvalid');
			area.removeAttribute('title');

			return;
		}

		var compiled = HmiExpr.compile(area.value,
			{project: that.editorUi.hmiProject, mode: 'script'});

		if (compiled.errors.length > 0)
		{
			area.classList.add('hmiInvalid');
			area.setAttribute('title', compiled.errors[0].message);
		}
		else
		{
			area.classList.remove('hmiInvalid');
			area.removeAttribute('title');
		}
	};

	mxEvent.addListener(area, 'input', validate);
	mxEvent.addListener(area, 'blur', function()
	{
		validate();

		if (cfg[field] !== area.value)
		{
			cfg[field] = area.value;
			that.commit();
		}
	});

	validate();

	return area;
};
