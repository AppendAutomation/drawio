/**
 * The Animation panel.
 *
 * Format destroys and rebuilds every panel on each selection change, so this
 * class is a pure projection of the model: it holds no state of its own, reads
 * the cell's `hmi` attribute on construction, and writes straight back on every
 * edit. UI-only state (which sections are expanded) lives on the EditorUi so it
 * survives the rebuild -- otherwise every selection change would collapse
 * everything the user had opened.
 */
HmiFormatPanel = function(format, editorUi, container)
{
	BaseFormatPanel.call(this, format, editorUi, container);
	this.init();
};

mxUtils.extend(HmiFormatPanel, BaseFormatPanel);

HmiFormatPanel.prototype.init = function()
{
	var ui = this.editorUi;
	var graph = ui.editor.graph;
	var cells = graph.getSelectionCells();

	if (ui.hmiUiState == null)
	{
		ui.hmiUiState = {expanded: {}};
	}

	// InTouch edits one object's links at a time and so do we; multi-select
	// editing is a later refinement, not a silent half-working feature.
	if (cells.length != 1)
	{
		this.container.appendChild(
			this.hmiCreateNotice(mxResources.get('hmiSelectSingle')));

		return;
	}

	this.cell = cells[0];
	this.links = HmiProject.getCellLinks(graph, this.cell);

	this.container.appendChild(this.addLauncher(this.createPanel()));

	for (var key in this.links)
	{
		var def = HmiTypes.LINKS[key];

		if (def != null)
		{
			this.addLinkSection(key, def);
		}
	}

	this.installFocusMemory();
};

/**
 * Keeps the caret where the user put it across a panel rebuild.
 *
 * Editing a field commits to the cell, which is a model change, which makes
 * Format destroy and rebuild every panel. So clicking from one field to the
 * next goes: mousedown on B, blur on A, commit, rebuild -- and the B the user
 * aimed at is destroyed before it ever receives focus, which is why the first
 * click appeared to do nothing and a second was needed.
 *
 * Upstream has the same problem and solves it by index, because a rebuild is
 * deterministic for a given selection; the same approach is used here. The
 * intent is captured on MOUSEDOWN, which fires before the blur that triggers
 * the rebuild -- capturing on focus would record the field being left rather
 * than the one being aimed at.
 */
HmiFormatPanel.prototype.installFocusMemory = function()
{
	var ui = this.editorUi;
	var container = this.container;
	var controls = this.focusableControls();

	for (var i = 0; i < controls.length; i++)
	{
		controls[i].setAttribute('data-hmi-focus', i);
	}

	var remember = function(evt)
	{
		var el = mxEvent.getSource(evt);

		while (el != null && el !== container &&
			(el.getAttribute == null || el.getAttribute('data-hmi-focus') == null))
		{
			el = el.parentNode;
		}

		if (el != null && el.getAttribute != null &&
			el.getAttribute('data-hmi-focus') != null)
		{
			ui.hmiFocus = {
				index: parseInt(el.getAttribute('data-hmi-focus'), 10),
				start: el.selectionStart,
				end: el.selectionEnd,
				at: Date.now()
			};
		}
	};

	mxEvent.addListener(container, 'mousedown', remember, true);
	mxEvent.addListener(container, 'focusin', remember);

	// Deferred: this panel is still display:none right now -- the tab router
	// reveals it after the constructor returns -- and focus() does nothing to
	// a hidden element.
	var that = this;
	var pending = ui.hmiFocus;

	window.setTimeout(function()
	{
		that.restoreFocusFrom(pending, controls);
	}, 0);
};

HmiFormatPanel.prototype.focusableControls = function()
{
	var res = [];
	var tags = ['input', 'select', 'textarea'];

	for (var t = 0; t < tags.length; t++)
	{
		var found = this.container.getElementsByTagName(tags[t]);

		for (var i = 0; i < found.length; i++)
		{
			res.push(found[i]);
		}
	}

	// Document order, so the index survives a rebuild.
	res.sort(function(a, b)
	{
		var pos = a.compareDocumentPosition(b);

		if (pos & Node.DOCUMENT_POSITION_FOLLOWING) { return -1; }
		if (pos & Node.DOCUMENT_POSITION_PRECEDING) { return 1; }

		return 0;
	});

	return res;
};

HmiFormatPanel.prototype.restoreFocusFrom = function(state, controls)
{
	if (state == null || controls[state.index] == null)
	{
		return;
	}

	// Only ever reclaim focus that the rebuild itself took away: if the user
	// has since landed somewhere else, leave them there.
	// The typing shim inside the diagram container does not count: once the
	// rebuild drops focus to the body the graph parks it there, and that is
	// exactly the focus being reclaimed.
	var active = document.activeElement;
	var name = (active != null) ? active.nodeName : '';
	var graph = this.editorUi.editor.graph;

	if ((name === 'INPUT' || name === 'TEXTAREA' || name === 'SELECT') &&
		!graph.container.contains(active))
	{
		return;
	}

	// And only while the interaction is still live, so a rebuild minutes later
	// cannot yank focus into the panel unprompted.
	if (Date.now() - state.at > 2000)
	{
		return;
	}

	var el = controls[state.index];
	el.focus();

	if (el.setSelectionRange != null && state.start != null)
	{
		try
		{
			el.setSelectionRange(state.start, state.end);
		}
		catch (e)
		{
			// Not every input type supports a selection range.
		}
	}
};

HmiFormatPanel.prototype.hmiCreateNotice = function(text)
{
	var div = this.createPanel();
	div.style.padding = '12px';
	div.style.color = 'gray';
	div.style.fontSize = '12px';
	mxUtils.write(div, text);

	return div;
};

// ---------------------------------------------------------------- launcher

/**
 * A compact grid of chips, one per available link type, grouped by family.
 * A configured link is marked, so "what is animated on this object" is
 * answerable at a glance -- the thing InTouch's Animation Links dialog is
 * really for.
 */
HmiFormatPanel.prototype.addLauncher = function(div)
{
	var that = this;

	div.appendChild(this.createTitle(mxResources.get('hmiAddLink')));

	var families = HmiTypes.FAMILIES;

	for (var f = 0; f < families.length; f++)
	{
		var family = families[f];
		var links = [];

		for (var key in HmiTypes.LINKS)
		{
			var def = HmiTypes.LINKS[key];

			if (def.family === family.id && def.milestone <= HmiTypes.MILESTONE)
			{
				links.push(def);
			}
		}

		if (links.length == 0)
		{
			continue;
		}

		var header = document.createElement('div');
		header.className = 'hmiLauncherGroup';
		mxUtils.write(header, family.label);
		div.appendChild(header);

		var grid = document.createElement('div');
		grid.className = 'hmiLauncherGrid';

		for (var i = 0; i < links.length; i++)
		{
			grid.appendChild(this.createChip(links[i]));
		}

		div.appendChild(grid);
	}

	return div;
};

HmiFormatPanel.prototype.createChip = function(def)
{
	var that = this;
	var configured = this.links[def.key] != null;

	var chip = document.createElement('div');
	chip.className = 'hmiChip' + ((configured) ? ' hmiChipOn' : '');
	chip.setAttribute('title', def.label);

	var text = document.createElement('span');
	mxUtils.write(text, this.chipLabel(def));
	chip.appendChild(text);

	if (configured)
	{
		var remove = document.createElement('span');
		remove.className = 'hmiChipRemove';
		mxUtils.write(remove, '×');
		remove.setAttribute('title', mxResources.get('hmiRemoveLink'));

		mxEvent.addListener(remove, 'click', function(evt)
		{
			mxEvent.consume(evt);
			that.removeLink(def.key);
		});

		chip.appendChild(remove);
	}

	mxEvent.addListener(chip, 'click', function(evt)
	{
		mxEvent.consume(evt);

		if (that.links[def.key] == null)
		{
			that.addLink(def);
		}
		else
		{
			that.toggleExpanded(def.key, true);
		}
	});

	return chip;
};

/** Strips the family prefix, which the group header already carries. */
HmiFormatPanel.prototype.chipLabel = function(def)
{
	var i = def.label.indexOf(' / ');

	return (i >= 0) ? def.label.substring(i + 3) : def.label;
};

// ------------------------------------------------------------- link edits

HmiFormatPanel.prototype.addLink = function(def)
{
	// One colour link per attribute. Discrete and Analog both drive the same
	// property, so holding both would make the result depend on evaluation
	// order rather than on anything the user chose. Adding one replaces the
	// other, as InTouch's own dialog does.
	var conflicts = HmiFormatPanel.conflictsWith(def);

	for (var i = 0; i < conflicts.length; i++)
	{
		delete this.links[conflicts[i]];
		delete this.editorUi.hmiUiState.expanded[conflicts[i]];
	}

	this.links[def.key] = (def.defaults != null) ? def.defaults() : {};
	this.editorUi.hmiUiState.expanded[def.key] = true;
	this.commit();
};

/**
 * Link keys that cannot coexist with the given one: every other link in the
 * same colour family, since they all write the same visual property.
 */
HmiFormatPanel.conflictsWith = function(def)
{
	var res = [];

	if (HmiRuntime.COLOR_TARGET[def.key] == null)
	{
		return res;
	}

	for (var key in HmiTypes.LINKS)
	{
		if (key !== def.key &&
			HmiRuntime.COLOR_TARGET[key] === HmiRuntime.COLOR_TARGET[def.key])
		{
			res.push(key);
		}
	}

	return res;
};

HmiFormatPanel.prototype.removeLink = function(key)
{
	delete this.links[key];
	delete this.editorUi.hmiUiState.expanded[key];
	this.commit();
};

HmiFormatPanel.prototype.toggleExpanded = function(key, value)
{
	var state = this.editorUi.hmiUiState.expanded;
	state[key] = (value != null) ? value : !state[key];
	this.refreshPanel();
};

/**
 * Writes the links back as one attribute. That is a single undoable edit, and
 * it triggers a model change, which makes Format rebuild this panel -- so
 * there is no separate redraw path to keep in sync.
 */
HmiFormatPanel.prototype.commit = function()
{
	HmiProject.setCellLinks(this.editorUi.editor.graph, this.cell, this.links);
};

/** Rebuilds the panel without touching the model (used for expand/collapse). */
HmiFormatPanel.prototype.refreshPanel = function()
{
	this.format.refresh();
};

// ---------------------------------------------------------- link sections

HmiFormatPanel.prototype.addLinkSection = function(key, def)
{
	var that = this;
	var cfg = this.links[key];
	var expanded = this.editorUi.hmiUiState.expanded[key] === true;

	var section = this.createCollapsibleSection(def.label, !expanded);

	var builder = HmiFormatPanel.BUILDERS[key] ||
		HmiFormatPanel.BUILDERS[def.family + '.*'];

	if (builder != null)
	{
		builder.call(this, section.contentDiv, cfg, key, def);
	}
	else
	{
		var note = document.createElement('div');
		note.style.padding = '8px';
		note.style.color = 'gray';
		mxUtils.write(note, 'Not yet implemented.');
		section.contentDiv.appendChild(note);
	}

	this.container.appendChild(section.wrapper);
};

/**
 * key (or "<family>.*") -> function(contentDiv, cfg, key, def)
 *
 * Registered as a table rather than a switch so that adding the remaining
 * InTouch link types is a local change.
 */
HmiFormatPanel.BUILDERS = {};

// -------------------------------------------------------- field builders

/**
 * A labelled row. The format panel is narrow, so labels sit above their
 * controls rather than beside them.
 */
HmiFormatPanel.prototype.addRow = function(parent, labelText, control)
{
	var row = document.createElement('div');
	row.className = 'hmiRow';

	var label = document.createElement('div');
	label.className = 'hmiRowLabel';
	mxUtils.write(label, labelText);
	row.appendChild(label);
	row.appendChild(control);
	parent.appendChild(row);

	return row;
};

/**
 * A text input bound to cfg[field]. Commits on blur and on Enter, because
 * committing per keystroke would put one undo entry on the stack per
 * character.
 */
HmiFormatPanel.prototype.createTextField = function(cfg, field, placeholder)
{
	var that = this;
	var input = document.createElement('input');
	input.className = 'hmiInput';
	input.setAttribute('type', 'text');
	input.value = (cfg[field] != null) ? cfg[field] : '';

	if (placeholder != null)
	{
		input.setAttribute('placeholder', placeholder);
	}

	var commit = function()
	{
		if (cfg[field] !== input.value)
		{
			cfg[field] = input.value;
			that.commit();
		}
	};

	mxEvent.addListener(input, 'blur', commit);
	mxEvent.addListener(input, 'keydown', function(evt)
	{
		if (evt.keyCode == 13)
		{
			commit();
			input.blur();
		}
		else if (evt.keyCode == 27)
		{
			input.value = (cfg[field] != null) ? cfg[field] : '';
			input.blur();
		}
	});

	return input;
};

/**
 * An expression field. Every numeric parameter in this fork is an expression,
 * not a literal, so this is the control most fields use.
 */
HmiFormatPanel.prototype.createExprField = function(cfg, field, placeholder)
{
	var input = this.createTextField(cfg, field, placeholder);
	input.className = 'hmiInput hmiExpr';

	var that = this;

	var validate = function()
	{
		if (typeof HmiExpr === 'undefined' || input.value === '')
		{
			input.classList.remove('hmiInvalid');
			input.removeAttribute('title');

			return;
		}

		// Compiled against the dictionary, so an unknown tag or dotfield is
		// caught here rather than showing up as a dead animation at runtime.
		var compiled = HmiExpr.compile(input.value,
			{project: that.editorUi.hmiProject});

		if (compiled.errors.length > 0)
		{
			input.classList.add('hmiInvalid');
			input.setAttribute('title', compiled.errors[0].message);
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

HmiFormatPanel.prototype.createSelectField = function(cfg, field, options)
{
	var that = this;
	var select = document.createElement('select');
	select.className = 'hmiInput';

	for (var i = 0; i < options.length; i++)
	{
		var opt = document.createElement('option');
		opt.setAttribute('value', options[i].value);
		mxUtils.write(opt, options[i].label);

		if (cfg[field] === options[i].value)
		{
			opt.setAttribute('selected', 'selected');
		}

		select.appendChild(opt);
	}

	mxEvent.addListener(select, 'change', function()
	{
		cfg[field] = select.value;
		that.commit();
	});

	return select;
};

/**
 * A colour swatch using drawio's own picker, so it behaves exactly like every
 * other colour control in the format panel.
 */
HmiFormatPanel.prototype.createColorField = function(cfg, field)
{
	var that = this;

	var btn = document.createElement('div');
	btn.className = 'hmiColor';
	btn.style.backgroundColor = cfg[field] || '#ffffff';

	mxEvent.addListener(btn, 'click', function(evt)
	{
		mxEvent.consume(evt);

		that.editorUi.pickColor(cfg[field] || '#ffffff', function(color)
		{
			cfg[field] = color;
			btn.style.backgroundColor = color;
			that.commit();
		});
	});

	return btn;
};

HmiFormatPanel.prototype.createCheckField = function(cfg, field, labelText)
{
	var that = this;
	var wrap = document.createElement('label');
	wrap.className = 'hmiCheck';

	var box = document.createElement('input');
	box.setAttribute('type', 'checkbox');

	if (cfg[field])
	{
		box.setAttribute('checked', 'checked');
	}

	mxEvent.addListener(box, 'change', function()
	{
		cfg[field] = box.checked;
		that.commit();
	});

	wrap.appendChild(box);
	mxUtils.write(wrap, labelText);

	return wrap;
};

// ------------------------------------------------------ center of rotation

/**
 * The center of an Orientation link: the object's center (the default), or a
 * point given in page coordinates or picked by clicking the page. It is kept
 * as an offset from the object's center (pivotDx, pivotDy), so it moves with
 * the object; the fields show it in page coordinates, where it is placed.
 */
HmiFormatPanel.prototype.addPivotControls = function(content, cfg)
{
	var that = this;
	var point = cfg.pivot === 'point';

	var mode = document.createElement('select');
	mode.className = 'hmiInput';
	mode.setAttribute('data-hmi-field', 'pivot');

	var options = [{value: 'center', label: 'Object center'}, {value: 'point', label: 'A point'}];

	for (var i = 0; i < options.length; i++)
	{
		var opt = document.createElement('option');
		opt.setAttribute('value', options[i].value);
		mxUtils.write(opt, options[i].label);

		if ((point ? 'point' : 'center') === options[i].value)
		{
			opt.setAttribute('selected', 'selected');
		}

		mode.appendChild(opt);
	}

	mxEvent.addListener(mode, 'change', function()
	{
		if (mode.value === 'point')
		{
			cfg.pivot = 'point';
			cfg.pivotDx = cfg.pivotDx || '0';
			cfg.pivotDy = cfg.pivotDy || '0';
		}
		else
		{
			delete cfg.pivot;
			delete cfg.pivotDx;
			delete cfg.pivotDy;
		}

		that.commit();
	});

	this.addRow(content, 'Rotate about', mode);

	if (!point)
	{
		return;
	}

	var center = HmiFormatPanel.cellCenter(this.editorUi.editor.graph, this.cell);
	var dx = parseFloat(cfg.pivotDx) || 0;
	var dy = parseFloat(cfg.pivotDy) || 0;

	var coord = function(axis, value)
	{
		var input = document.createElement('input');
		input.className = 'hmiInput';
		input.setAttribute('type', 'text');
		input.setAttribute('data-hmi-field', 'pivot' + axis.toUpperCase());
		input.value = HmiFormatPanel.roundCoord(value);

		var commit = function()
		{
			var v = parseFloat(input.value);

			if (isNaN(v))
			{
				input.value = HmiFormatPanel.roundCoord(value);

				return;
			}

			var offset = HmiFormatPanel.roundCoord(v - center[axis]);
			var field = (axis === 'x') ? 'pivotDx' : 'pivotDy';

			if (cfg[field] !== offset)
			{
				cfg[field] = offset;
				that.commit();
			}
		};

		mxEvent.addListener(input, 'blur', commit);
		mxEvent.addListener(input, 'keydown', function(evt)
		{
			if (evt.keyCode == 13)
			{
				commit();
				input.blur();
			}
			else if (evt.keyCode == 27)
			{
				input.value = HmiFormatPanel.roundCoord(value);
				input.blur();
			}
		});

		return input;
	};

	this.addRow(content, 'Center X (page)', coord('x', center.x + dx));
	this.addRow(content, 'Center Y (page)', coord('y', center.y + dy));

	var pick = document.createElement('button');
	pick.className = 'hmiButton';
	pick.setAttribute('data-hmi-field', 'pivotPick');
	mxUtils.write(pick, 'Pick on page');

	mxEvent.addListener(pick, 'click', function(evt)
	{
		mxEvent.consume(evt);
		HmiFormatPanel.pickPivot(that.editorUi, that.cell, cfg);
	});

	content.appendChild(pick);
	content.appendChild(HmiDialogs.el('div', 'hmiHint',
		'Click Pick on page, then click where the object should turn about ' +
		'(Esc cancels). The point moves with the object.'));

	this.showPivotMarker(center.x + dx, center.y + dy);
};

HmiFormatPanel.roundCoord = function(v)
{
	return String(Math.round(v * 100) / 100);
};

/**
 * A cell's center in page (diagram) coordinates, through any groups. That is
 * what the shape turns about. A connector has no bounds of its own (it is
 * defined by its points), so its drawn bounds are used.
 */
HmiFormatPanel.cellCenter = function(graph, cell)
{
	var model = graph.getModel();

	if (model.isEdge(cell))
	{
		var es = graph.view.getState(cell);
		var s = graph.view.scale;
		var t = graph.view.translate;

		if (es != null)
		{
			return {x: es.getCenterX() / s - t.x, y: es.getCenterY() / s - t.y};
		}
	}

	var geo = graph.getCellGeometry(cell);
	var x = (geo != null) ? geo.x + geo.width / 2 : 0;
	var y = (geo != null) ? geo.y + geo.height / 2 : 0;
	var parent = model.getParent(cell);

	while (parent != null && model.isVertex(parent))
	{
		var pg = graph.getCellGeometry(parent);

		if (pg != null && !pg.relative)
		{
			x += pg.x;
			y += pg.y;
		}

		parent = model.getParent(parent);
	}

	return {x: x, y: y};
};

/**
 * One click on the page sets the center of rotation. The click is taken
 * before the editor's own handlers, so it neither selects nor moves anything.
 */
HmiFormatPanel.pickPivot = function(ui, cell, cfg)
{
	var graph = ui.editor.graph;

	HmiFormatPanel.cancelPivotPick(ui);

	var finish = function()
	{
		HmiFormatPanel.cancelPivotPick(ui);
	};

	// The point is set on the press; the listener stays until the release,
	// which it also takes, or the editor would treat it as a click on the
	// background and clear the selection
	var picked = false;

	var listener = {
		mouseDown: function(sender, me)
		{
			var pt = graph.getPointForEvent(me.getEvent(), false);
			var center = HmiFormatPanel.cellCenter(graph, cell);
			var links = HmiProject.getCellLinks(graph, cell);
			var link = links['orientation'];

			me.consume();
			picked = true;

			if (link != null)
			{
				link.pivot = 'point';
				link.pivotDx = HmiFormatPanel.roundCoord(pt.x - center.x);
				link.pivotDy = HmiFormatPanel.roundCoord(pt.y - center.y);
				HmiProject.setCellLinks(graph, cell, links);
			}
		},
		mouseMove: function(sender, me)
		{
			me.consume();
		},
		mouseUp: function(sender, me)
		{
			me.consume();

			if (picked)
			{
				finish();
			}
		}
	};

	var keyDown = function(evt)
	{
		if (evt.keyCode == 27)
		{
			mxEvent.consume(evt);
			finish();
		}
	};

	// First in line, ahead of selection, moving and rubberband
	graph.mouseListeners = graph.mouseListeners || [];
	graph.mouseListeners.unshift(listener);
	// Capture phase, ahead of the editor's own Escape handling
	document.addEventListener('keydown', keyDown, true);

	var cursor = graph.container.style.cursor;
	graph.container.style.cursor = 'crosshair';

	ui.hmiPivotPick = function()
	{
		graph.removeMouseListener(listener);
		document.removeEventListener('keydown', keyDown, true);
		graph.container.style.cursor = cursor;
	};
};

HmiFormatPanel.cancelPivotPick = function(ui)
{
	if (ui.hmiPivotPick != null)
	{
		var cancel = ui.hmiPivotPick;
		ui.hmiPivotPick = null;
		cancel();
	}
};

/** A small crosshair on the page where the object will turn about. */
HmiFormatPanel.prototype.showPivotMarker = function(x, y)
{
	var graph = this.editorUi.editor.graph;
	var marker = document.createElement('div');
	marker.className = 'hmiPivotMarker';
	graph.container.appendChild(marker);

	var place = function()
	{
		var s = graph.view.scale;
		var t = graph.view.translate;
		marker.style.left = Math.round((x + t.x) * s) + 'px';
		marker.style.top = Math.round((y + t.y) * s) + 'px';
	};

	place();
	graph.view.addListener(mxEvent.SCALE, place);
	graph.view.addListener(mxEvent.TRANSLATE, place);
	graph.view.addListener(mxEvent.SCALE_AND_TRANSLATE, place);

	this.pivotMarker = {node: marker, place: place};
};

HmiFormatPanel.prototype.destroy = function()
{
	if (this.pivotMarker != null)
	{
		var view = this.editorUi.editor.graph.view;
		view.removeListener(this.pivotMarker.place);

		if (this.pivotMarker.node.parentNode != null)
		{
			this.pivotMarker.node.parentNode.removeChild(this.pivotMarker.node);
		}

		this.pivotMarker = null;
	}

	BaseFormatPanel.prototype.destroy.apply(this, arguments);
};
