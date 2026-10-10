/**
 * Arcs: an open curve along a circle (arcType=circle, kept round) or along
 * the ellipse filling its bounds (arcType=ellipse), drawn clockwise from
 * arcStart to arcEnd. Angles are degrees, 0 at twelve o'clock, increasing
 * clockwise. Like a line, each end can carry a marker (startArrow, endArrow,
 * with startSize/endSize and startFill/endFill), drawn by mxMarker so arcs
 * and connectors share their arrowheads; strokeWidth is the line width.
 *
 * The shape is a vertex, so animation links (colors, blink, visibility,
 * rotation...) work on it as on any object.
 */
HmiArc = function() {};

HmiArc.SHAPE = 'hmiArc';

/** Ends a user can choose, as in the line end menus. */
HmiArc.MARKERS = [['none', 'None'], ['classic', 'Classic'], ['classicThin', 'Classic thin'],
	['block', 'Block'], ['blockThin', 'Block thin'], ['open', 'Open'], ['openThin', 'Open thin'],
	['oval', 'Oval'], ['diamond', 'Diamond'], ['diamondThin', 'Diamond thin'], ['box', 'Box'],
	['halfCircle', 'Half circle'], ['dash', 'Dash'], ['cross', 'Cross'], ['circle', 'Circle'],
	['circlePlus', 'Circle plus']];

HmiArc.DEFAULTS = {arcType: 'ellipse', arcStart: 270, arcEnd: 90};

/** The two palette styles: a circle arc (kept round) and an ellipse arc. */
HmiArc.CIRCLE_STYLE = 'shape=hmiArc;arcType=circle;aspect=fixed;arcStart=270;arcEnd=90;' +
	'startArrow=none;endArrow=none;fillColor=none;html=1;';
HmiArc.ELLIPSE_STYLE = 'shape=hmiArc;arcType=ellipse;arcStart=270;arcEnd=90;' +
	'startArrow=none;endArrow=none;fillColor=none;html=1;';

HmiArc.install = function()
{
	HmiArc.installShape();
	HmiArc.installPalette();
	HmiArc.installFormat();
};

// ------------------------------------------------------------------ geometry

/** A number from a style, or the default when it is missing or not a number. */
HmiArc.number = function(style, key, def)
{
	var v = parseFloat((style != null) ? style[key] : null);

	return isNaN(v) ? def : v;
};

/** Degrees swept clockwise from start to end: (0, 360]; equal angles are a full circle. */
HmiArc.sweep = function(start, end)
{
	var s = ((end - start) % 360 + 360) % 360;

	return (s === 0) ? 360 : s;
};

/**
 * The arc as points (sampled along the curve), in the given bounds. The
 * centre and radii follow the type: an ellipse fills the bounds, a circle
 * takes the smaller side, centred.
 */
HmiArc.points = function(style, x, y, w, h)
{
	var circle = mxUtils.getValue(style, 'arcType', HmiArc.DEFAULTS.arcType) == 'circle';
	var rx = (circle) ? Math.min(w, h) / 2 : w / 2;
	var ry = (circle) ? rx : h / 2;
	var cx = x + w / 2;
	var cy = y + h / 2;
	var start = HmiArc.number(style, 'arcStart', HmiArc.DEFAULTS.arcStart);
	var sweep = HmiArc.sweep(start, HmiArc.number(style, 'arcEnd', HmiArc.DEFAULTS.arcEnd));
	var n = Math.max(8, Math.ceil(sweep / 2));
	var pts = [];

	for (var i = 0; i <= n; i++)
	{
		var t = (start + sweep * i / n) * Math.PI / 180;
		pts.push(new mxPoint(cx + rx * Math.sin(t), cy - ry * Math.cos(t)));
	}

	return {points: pts, rx: rx, ry: ry, start: start, sweep: sweep};
};

/** Removes length from the start (fromStart) or end of a polyline, in place. */
HmiArc.trim = function(pts, length, fromStart)
{
	if (fromStart)
	{
		pts.reverse();
	}

	while (length > 0 && pts.length > 1)
	{
		var a = pts[pts.length - 1];
		var b = pts[pts.length - 2];
		var d = Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));

		if (d > length)
		{
			var f = length / d;
			pts[pts.length - 1] = new mxPoint(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
			length = 0;
		}
		else
		{
			pts.pop();
			length -= d;
		}
	}

	if (fromStart)
	{
		pts.reverse();
	}
};

// ------------------------------------------------------------------ shape

HmiArc.installShape = function()
{
	if (mxCellRenderer.defaultShapes[HmiArc.SHAPE] != null)
	{
		return;
	}

	function HmiArcShape()
	{
		mxShape.call(this);
	};

	mxUtils.extend(HmiArcShape, mxShape);

	HmiArcShape.prototype.isRoundable = function() { return false; };

	HmiArcShape.prototype.paintVertexShape = function(c, x, y, w, h)
	{
		var arc = HmiArc.points(this.style, x, y, w, h);
		var pts = arc.points;
		var sw = this.strokewidth || 1;
		var paint = [];

		// Each marker is told the end point and the direction leaving the
		// line there; it moves the point back to where the line must stop
		var marker = function(fromStart)
		{
			var type = mxUtils.getValue(this.style, (fromStart) ? 'startArrow' : 'endArrow', mxConstants.NONE);

			if (type == mxConstants.NONE || pts.length < 2)
			{
				return;
			}

			var t = (arc.start + ((fromStart) ? 0 : arc.sweep)) * Math.PI / 180;
			var dx = arc.rx * Math.cos(t);
			var dy = arc.ry * Math.sin(t);
			var len = Math.sqrt(dx * dx + dy * dy) || 1;
			var ux = (fromStart) ? -dx / len : dx / len;
			var uy = (fromStart) ? -dy / len : dy / len;
			var end = (fromStart) ? pts[0] : pts[pts.length - 1];
			var pe = end.clone();
			var size = HmiArc.number(this.style, (fromStart) ? 'startSize' : 'endSize', mxConstants.DEFAULT_MARKERSIZE);
			var filled = mxUtils.getValue(this.style, (fromStart) ? 'startFill' : 'endFill', 1) != 0;
			var f = mxMarker.createMarker(c, this, type, pe, ux, uy, size, fromStart, sw, filled);

			if (f != null)
			{
				HmiArc.trim(pts, Math.sqrt((pe.x - end.x) * (pe.x - end.x) + (pe.y - end.y) * (pe.y - end.y)), fromStart);
				paint.push(f);
			}
		};

		marker.call(this, true);
		marker.call(this, false);

		c.begin();
		c.moveTo(pts[0].x, pts[0].y);

		for (var i = 1; i < pts.length; i++)
		{
			c.lineTo(pts[i].x, pts[i].y);
		}

		c.stroke();

		// Markers are solid and take the line's color
		if (paint.length > 0)
		{
			c.setDashed(false);
			c.setFillColor(this.stroke);

			for (var j = 0; j < paint.length; j++)
			{
				paint[j]();
			}
		}
	};

	mxCellRenderer.registerShape(HmiArc.SHAPE, HmiArcShape);
};

// ------------------------------------------------------------------ palette

/** The two arcs join the General palette, after its own entries. */
HmiArc.installPalette = function()
{
	if (typeof Sidebar === 'undefined' || Sidebar.prototype.hmiArcPalette)
	{
		return;
	}

	Sidebar.prototype.hmiArcPalette = true;
	var addPaletteFunctions = Sidebar.prototype.addPaletteFunctions;

	Sidebar.prototype.addPaletteFunctions = function(id, title, expanded, fns)
	{
		if (id === 'general' && fns != null)
		{
			var tags = 'arc arcs curve circle ellipse line arrow ';
			fns = fns.concat([
				this.createVertexTemplateEntry(HmiArc.CIRCLE_STYLE, 80, 80, '', 'Arc (Circle)', null, null, tags + 'round'),
				this.createVertexTemplateEntry(HmiArc.ELLIPSE_STYLE, 120, 80, '', 'Arc (Ellipse)', null, null, tags + 'oval')
			]);
		}

		return addPaletteFunctions.call(this, id, title, expanded, fns);
	};
};

// ------------------------------------------------------------------ Style tab

/** An Arc section at the top of the Style tab while only arcs are selected. */
HmiArc.installFormat = function()
{
	if (typeof StyleFormatPanel === 'undefined' || StyleFormatPanel.prototype.hmiArcFormat)
	{
		return;
	}

	StyleFormatPanel.prototype.hmiArcFormat = true;
	var init = StyleFormatPanel.prototype.init;

	StyleFormatPanel.prototype.init = function()
	{
		init.apply(this, arguments);

		var cells = this.editorUi.editor.graph.getSelectionCells();

		if (HmiArc.allArcs(this.editorUi.editor.graph, cells))
		{
			var sec = this.createCollapsibleSection('Arc', false);
			sec.wrapper.setAttribute('data-hmi-arc-section', '1');
			sec.contentDiv.appendChild(HmiArc.createPanel(this, cells));
			this.container.insertBefore(sec.wrapper, this.container.firstChild);

			// An arc is a line: it has no fill
			HmiArc.removeSection(this.container, mxResources.get('fill'));
		}
	};
};

/** Removes the collapsible section whose title is the given text. */
HmiArc.removeSection = function(container, title)
{
	for (var i = container.childNodes.length - 1; i >= 0; i--)
	{
		var sec = container.childNodes[i];
		var head = (sec.firstChild != null) ? ('' + sec.firstChild.textContent).trim() : '';

		if (head === title && sec.getAttribute('data-hmi-arc-section') == null)
		{
			container.removeChild(sec);
		}
	}
};

HmiArc.allArcs = function(graph, cells)
{
	if (cells == null || cells.length === 0)
	{
		return false;
	}

	for (var i = 0; i < cells.length; i++)
	{
		if (!graph.getModel().isVertex(cells[i]) ||
			mxUtils.getValue(graph.getCellStyle(cells[i]), 'shape', null) != HmiArc.SHAPE)
		{
			return false;
		}
	}

	return true;
};

HmiArc.createPanel = function(panel, cells)
{
	var graph = panel.editorUi.editor.graph;
	var style = graph.getCellStyle(cells[0]);
	var div = panel.createPanel();
	div.className = (div.className || '') + ' hmiArcPanel';

	var set = function(key, value)
	{
		graph.getModel().beginUpdate();

		try
		{
			graph.setCellStyles(key, value, cells);
		}
		finally
		{
			graph.getModel().endUpdate();
		}
	};

	var row = function(label, control)
	{
		var r = document.createElement('div');
		r.className = 'hmiArcRow';
		var l = document.createElement('span');
		l.className = 'hmiArcLabel';
		mxUtils.write(l, label);
		r.appendChild(l);
		r.appendChild(control);
		div.appendChild(r);

		return control;
	};

	var number = function(key, def, min, max, step, field)
	{
		var input = document.createElement('input');
		input.type = 'number';
		input.className = 'hmiArcNumber';
		input.setAttribute('data-hmi-arc', field);
		input.min = min;
		input.max = max;
		input.step = step;
		input.value = HmiArc.number(style, key, def);

		mxEvent.addListener(input, 'change', function()
		{
			var v = parseFloat(input.value);

			if (!isNaN(v))
			{
				set(key, Math.max(min, Math.min(max, v)));
			}
		});

		return input;
	};

	var marker = function(key, field)
	{
		var select = document.createElement('select');
		select.className = 'hmiArcSelect';
		select.setAttribute('data-hmi-arc', field);
		var current = mxUtils.getValue(style, key, mxConstants.NONE);

		for (var i = 0; i < HmiArc.MARKERS.length; i++)
		{
			var opt = document.createElement('option');
			opt.value = HmiArc.MARKERS[i][0];
			mxUtils.write(opt, HmiArc.MARKERS[i][1]);
			opt.selected = HmiArc.MARKERS[i][0] == current;
			select.appendChild(opt);
		}

		mxEvent.addListener(select, 'change', function() { set(key, select.value); });

		return select;
	};

	var filled = function(key, field)
	{
		var box = document.createElement('input');
		box.type = 'checkbox';
		box.setAttribute('data-hmi-arc', field);
		box.checked = mxUtils.getValue(style, key, 1) != 0;
		mxEvent.addListener(box, 'change', function() { set(key, (box.checked) ? 1 : 0); });

		return box;
	};

	row('Start angle (°)', number('arcStart', HmiArc.DEFAULTS.arcStart, -360, 360, 1, 'start'));
	row('End angle (°)', number('arcEnd', HmiArc.DEFAULTS.arcEnd, -360, 360, 1, 'end'));
	row('Line width', number(mxConstants.STYLE_STROKEWIDTH, 1, 0, 999, 1, 'width'));
	row('Start arrow', marker('startArrow', 'startArrow'));
	row('Start size', number('startSize', mxConstants.DEFAULT_MARKERSIZE, 0, 999, 1, 'startSize'));
	row('Start filled', filled('startFill', 'startFill'));
	row('End arrow', marker('endArrow', 'endArrow'));
	row('End size', number('endSize', mxConstants.DEFAULT_MARKERSIZE, 0, 999, 1, 'endSize'));
	row('End filled', filled('endFill', 'endFill'));

	var hint = document.createElement('div');
	hint.className = 'hmiHint';
	mxUtils.write(hint, '0° is twelve o\'clock; the arc runs clockwise from the start angle to the end angle.');
	div.appendChild(hint);

	return div;
};
