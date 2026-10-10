/**
 * Arcs: an open curve along a circle (arcType=circle, kept round) or along
 * the ellipse filling its bounds (arcType=ellipse), drawn counterclockwise
 * from arcStart to arcEnd. Angles are degrees measured as on a protractor: 0
 * at the right (three o'clock), increasing counterclockwise, so 90 is the
 * top; a start greater than the end sweeps through 0. Like a line, each end
 * can carry a marker (startArrow, endArrow, with startSize/endSize and
 * startFill/endFill), drawn by mxMarker so arcs and connectors share their
 * arrowheads. The line width runs from strokeWidth at the start to
 * arcEndWidth at the end (the same when it is not set).
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

HmiArc.DEFAULTS = {arcType: 'ellipse', arcStart: 0, arcEnd: 180};

/** The two palette styles: a circle arc (kept round) and an ellipse arc. */
HmiArc.CIRCLE_STYLE = 'shape=hmiArc;arcType=circle;aspect=fixed;arcStart=0;arcEnd=180;' +
	'startArrow=none;endArrow=none;fillColor=none;html=1;';
HmiArc.ELLIPSE_STYLE = 'shape=hmiArc;arcType=ellipse;arcStart=0;arcEnd=180;' +
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

/** Degrees swept counterclockwise from start to end: (0, 360]; equal angles are a full circle. */
HmiArc.sweep = function(start, end)
{
	var s = ((end - start) % 360 + 360) % 360;

	return (s === 0) ? 360 : s;
};

/**
 * The arc as points sampled along the curve, each with f, its fraction of the
 * way from the start (0) to the end (1). The centre and radii follow the
 * type: an ellipse fills the bounds, a circle takes the smaller side, centred.
 * Screen y grows downwards, so a counterclockwise angle a is at
 * (cx + rx cos a, cy - ry sin a).
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
		var a = (start + sweep * i / n) * Math.PI / 180;
		var p = new mxPoint(cx + rx * Math.cos(a), cy - ry * Math.sin(a));
		p.f = i / n;
		pts.push(p);
	}

	return {points: pts, rx: rx, ry: ry, start: start, sweep: sweep};
};

/** The direction of travel (increasing angle) at angle a, in degrees, as a unit vector. */
HmiArc.direction = function(arc, a)
{
	var t = a * Math.PI / 180;
	var dx = -arc.rx * Math.sin(t);
	var dy = -arc.ry * Math.cos(t);
	var len = Math.sqrt(dx * dx + dy * dy) || 1;

	return {x: dx / len, y: dy / len};
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
			var k = length / d;
			var p = new mxPoint(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);

			if (a.f != null && b.f != null)
			{
				p.f = a.f + (b.f - a.f) * k;
			}

			pts[pts.length - 1] = p;
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

/**
 * A line whose width changes along it, as a closed outline: each point is
 * offset by half its width either side of the line.
 */
HmiArc.taper = function(pts, startWidth, endWidth)
{
	var left = [];
	var right = [];

	for (var i = 0; i < pts.length; i++)
	{
		var a = pts[Math.max(0, i - 1)];
		var b = pts[Math.min(pts.length - 1, i + 1)];
		var dx = b.x - a.x;
		var dy = b.y - a.y;
		var len = Math.sqrt(dx * dx + dy * dy) || 1;
		var f = (pts[i].f != null) ? pts[i].f : i / Math.max(1, pts.length - 1);
		var half = (startWidth + (endWidth - startWidth) * f) / 2;
		var nx = -dy / len * half;
		var ny = dx / len * half;
		left.push(new mxPoint(pts[i].x + nx, pts[i].y + ny));
		right.push(new mxPoint(pts[i].x - nx, pts[i].y - ny));
	}

	return left.concat(right.reverse());
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
		var startWidth = this.strokewidth || 1;
		var endWidth = HmiArc.number(this.style, 'arcEndWidth', startWidth);
		var paint = [];

		// Each marker is told the end point and the direction leaving the
		// line there; it moves the point back to where the line must stop.
		// It is sized for the line's width at its own end.
		var marker = function(fromStart)
		{
			var type = mxUtils.getValue(this.style, (fromStart) ? 'startArrow' : 'endArrow', mxConstants.NONE);

			if (type == mxConstants.NONE || pts.length < 2)
			{
				return;
			}

			var dir = HmiArc.direction(arc, arc.start + ((fromStart) ? 0 : arc.sweep));
			var ux = (fromStart) ? -dir.x : dir.x;
			var uy = (fromStart) ? -dir.y : dir.y;
			var end = (fromStart) ? pts[0] : pts[pts.length - 1];
			var pe = end.clone();
			var sw = (fromStart) ? startWidth : endWidth;
			var size = HmiArc.number(this.style, (fromStart) ? 'startSize' : 'endSize', mxConstants.DEFAULT_MARKERSIZE);
			var filled = mxUtils.getValue(this.style, (fromStart) ? 'startFill' : 'endFill', 1) != 0;
			var f = mxMarker.createMarker(c, this, type, pe, ux, uy, size, fromStart, sw, filled);

			if (f != null)
			{
				HmiArc.trim(pts, Math.sqrt((pe.x - end.x) * (pe.x - end.x) + (pe.y - end.y) * (pe.y - end.y)), fromStart);
				paint.push({sw: sw, paint: f});
			}
		};

		marker.call(this, true);
		marker.call(this, false);

		if (Math.abs(endWidth - startWidth) < 0.01)
		{
			// One width: an ordinary stroke (dashes and line caps apply)
			c.begin();
			c.moveTo(pts[0].x, pts[0].y);

			for (var i = 1; i < pts.length; i++)
			{
				c.lineTo(pts[i].x, pts[i].y);
			}

			c.stroke();
		}
		else
		{
			// Start to end width: the line is filled as an outline
			var outline = HmiArc.taper(pts, startWidth, endWidth);
			c.setFillColor(this.stroke);
			c.begin();
			c.moveTo(outline[0].x, outline[0].y);

			for (var k = 1; k < outline.length; k++)
			{
				c.lineTo(outline[k].x, outline[k].y);
			}

			c.close();
			c.fill();
		}

		// Markers are solid and take the line's color
		if (paint.length > 0)
		{
			c.setDashed(false);
			c.setFillColor(this.stroke);

			for (var j = 0; j < paint.length; j++)
			{
				c.setStrokeWidth(paint[j].sw);
				paint[j].paint();
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
	row('Start line width', number(mxConstants.STYLE_STROKEWIDTH, 1, 0, 999, 1, 'width'));
	row('End line width', number('arcEndWidth', HmiArc.number(style, mxConstants.STYLE_STROKEWIDTH, 1), 0, 999, 1, 'endWidth'));
	row('Start arrow', marker('startArrow', 'startArrow'));
	row('Start size', number('startSize', mxConstants.DEFAULT_MARKERSIZE, 0, 999, 1, 'startSize'));
	row('Start filled', filled('startFill', 'startFill'));
	row('End arrow', marker('endArrow', 'endArrow'));
	row('End size', number('endSize', mxConstants.DEFAULT_MARKERSIZE, 0, 999, 1, 'endSize'));
	row('End filled', filled('endFill', 'endFill'));

	var hint = document.createElement('div');
	hint.className = 'hmiHint';
	mxUtils.write(hint, 'Angles are measured as on a protractor: 0° at the right, counterclockwise, so 90° is the top. ' +
		'The arc runs counterclockwise from the start angle to the end angle. A line whose widths differ is drawn solid.');
	div.appendChild(hint);

	return div;
};
