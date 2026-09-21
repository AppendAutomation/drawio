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
			this.createExprField(cfg, 'expr', 'Pump1_Run'));
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
			this.createExprField(cfg, 'expr', 'Tank_Level'));

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

			row.appendChild(this.createExprField(band, 'max', 'value'));

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
			this.createExprField(cfg, 'expr', 'NOT Alarm_Ack'));
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
			this.createExprField(cfg, 'expr', 'HiAlarm'));
		this.addRow(content, mxResources.get('hmiRate'),
			this.createExprField(cfg, 'rateMs', '500'));

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
			this.createExprField(cfg, 'expr', 'Tank_Level'));

		if (cfg.kind != 'string')
		{
			this.addRow(content, mxResources.get('hmiFormat'),
				this.createTextField(cfg, 'format', '0.0'));
		}

		this.addRow(content, mxResources.get('hmiPrefix'),
			this.createTextField(cfg, 'prefix', ''));
		this.addRow(content, mxResources.get('hmiSuffix'),
			this.createTextField(cfg, 'suffix', ' %'));
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
				this.createExprField(cfg, 'min', '0'));
			this.addRow(content, mxResources.get('hmiMax'),
				this.createExprField(cfg, 'max', 'Tank_Level.MaxEU'));
		}

		this.addRow(content, mxResources.get('hmiPrompt'),
			this.createTextField(cfg, 'prompt', 'Enter value'));
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
			this.createExprField(cfg, 'enableExpr', ''));
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

	var input = this.createTextField(cfg, field, 'TagName');

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
