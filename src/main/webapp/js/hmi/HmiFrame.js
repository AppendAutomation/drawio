/**
 * Draws the target screen and the current page's window on the editor canvas.
 *
 * Page coordinates are screen coordinates: a window at (x, y) shows whatever
 * is drawn at (x, y) on its page. So a solid border at the origin, the size of
 * the application's resolution, is the device screen, and a dashed border is
 * exactly the part of the page the window will show -- drawn where it will
 * appear.
 *
 * Both live in the view's background pane, behind every cell, and are redrawn
 * with the background so zoom, pan and page changes keep them in place. Only
 * the editor's graph gets them; run-mode window graphs do not.
 */
HmiFrame = function() {};

HmiFrame.SCREEN_COLOR = '#1a73e8';
HmiFrame.WINDOW_COLOR = '#e8710a';

HmiFrame.install = function()
{
	var validateBackground = mxGraphView.prototype.validateBackground;

	mxGraphView.prototype.validateBackground = function()
	{
		validateBackground.apply(this, arguments);

		if (this.graph.hmiUi != null)
		{
			HmiLog.guard('frame', mxUtils.bind(this, function()
			{
				HmiFrame.draw(this.graph.hmiUi);
			}));
		}
	};
};

/** Redraws now, after the settings or window properties change. */
HmiFrame.refresh = function(ui)
{
	if (ui != null && ui.editor != null)
	{
		HmiFrame.draw(ui);
	}
};

HmiFrame.draw = function(ui)
{
	var graph = ui.editor.graph;
	var view = graph.view;
	var pane = view.getBackgroundPane();
	var project = ui.hmiProject;

	if (pane == null)
	{
		return;
	}

	var group = ui.hmiFrameGroup;

	if (project == null || ui.currentPage == null)
	{
		if (group != null && group.parentNode != null)
		{
			group.parentNode.removeChild(group);
		}

		return;
	}

	if (group == null)
	{
		group = HmiFrame.createGroup();
		ui.hmiFrameGroup = group;
	}

	// Appended last so it sits over the background page, still under cells.
	if (group.parentNode !== pane || pane.lastChild !== group)
	{
		pane.appendChild(group);
	}

	var s = view.scale;
	var tr = view.translate;
	var res = project.settings;
	var w = project.getWindow(ui.currentPage.getId());
	var tb = (w.titleBar) ? HmiProject.TITLE_BAR_HEIGHT : 0;

	var at = function(x, y)
	{
		return {x: (x + tr.x) * s, y: (y + tr.y) * s};
	};

	var p = at(0, 0);
	HmiFrame.setRect(group.screen, p.x, p.y, res.width * s, res.height * s);
	HmiFrame.setText(group.screenLabel, p.x, p.y - 5,
		'Screen ' + res.width + ' \u00D7 ' + res.height);

	// A full-screen window coincides with the screen border; the dashed one
	// would only muddy it, so it is left out.
	var full = w.x === 0 && w.y === 0 && w.width === res.width &&
		w.height === res.height && !w.titleBar;
	var display = (full) ? 'none' : '';

	group.window.style.display = display;
	group.windowLabel.style.display = display;
	group.titleLine.style.display = (full || tb === 0) ? 'none' : '';

	var q = at(w.x, w.y);
	HmiFrame.setRect(group.window, q.x, q.y, w.width * s, w.height * s);

	var type = {replace: 'Replace', overlay: 'Overlay', popup: 'Popup'}[w.type];
	HmiFrame.setText(group.windowLabel, q.x, q.y - 5,
		ui.currentPage.getName() + ' \u2014 ' + type + ', ' + w.width +
		' \u00D7 ' + w.height);

	if (tb > 0)
	{
		var line = group.titleLine;
		line.setAttribute('x1', q.x);
		line.setAttribute('x2', q.x + w.width * s);
		line.setAttribute('y1', q.y + tb * s);
		line.setAttribute('y2', q.y + tb * s);
	}
};

HmiFrame.createGroup = function()
{
	var ns = mxConstants.NS_SVG;
	var group = document.createElementNS(ns, 'g');
	group.setAttribute('class', 'hmiFrame');
	group.setAttribute('pointer-events', 'none');

	var rect = function(color, dash, width)
	{
		var r = document.createElementNS(ns, 'rect');
		r.setAttribute('fill', 'none');
		r.setAttribute('stroke', color);
		r.setAttribute('stroke-width', width);

		if (dash != null)
		{
			r.setAttribute('stroke-dasharray', dash);
		}

		group.appendChild(r);

		return r;
	};

	var text = function(color)
	{
		var t = document.createElementNS(ns, 'text');
		t.setAttribute('fill', color);
		t.setAttribute('font-size', '11');
		t.setAttribute('font-family', 'Helvetica, Arial, sans-serif');
		group.appendChild(t);

		return t;
	};

	group.screen = rect(HmiFrame.SCREEN_COLOR, null, 2);
	group.screen.setAttribute('data-hmi-frame', 'screen');
	group.screenLabel = text(HmiFrame.SCREEN_COLOR);

	group.window = rect(HmiFrame.WINDOW_COLOR, '6 4', 1.5);
	group.window.setAttribute('data-hmi-frame', 'window');
	group.windowLabel = text(HmiFrame.WINDOW_COLOR);

	group.titleLine = document.createElementNS(ns, 'line');
	group.titleLine.setAttribute('stroke', HmiFrame.WINDOW_COLOR);
	group.titleLine.setAttribute('stroke-width', 1);
	group.titleLine.setAttribute('stroke-dasharray', '2 3');
	group.appendChild(group.titleLine);

	return group;
};

HmiFrame.setRect = function(node, x, y, w, h)
{
	node.setAttribute('x', Math.round(x) + 0.5);
	node.setAttribute('y', Math.round(y) + 0.5);
	node.setAttribute('width', Math.max(0, Math.round(w)));
	node.setAttribute('height', Math.max(0, Math.round(h)));
};

HmiFrame.setText = function(node, x, y, text)
{
	node.setAttribute('x', Math.round(x));
	node.setAttribute('y', Math.round(y));

	if (node.textContent !== text)
	{
		node.textContent = text;
	}
};
