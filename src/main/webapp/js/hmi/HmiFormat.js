/**
 * The fourth format-panel tab.
 *
 * Upstream builds the tab strip inside Format.prototype.immediateRefresh, and
 * the click routing lives in closure locals (addClickHandler, currentLabel,
 * currentPanel) that a wrapper cannot reach. The last tab is also registered
 * with lastEntry=true, so merely appending a fourth tab leaves that closure
 * believing Arrange is active: clicking back to Arrange then hits
 * `if (currentLabel != elt)`, finds it false, and does nothing, stranding the
 * user on a stuck panel.
 *
 * Rather than fight the closure, we append the tab and then take over routing
 * for ALL tabs with one capture-phase listener on the title container. Because
 * capture runs before the target phase and we stopPropagation, upstream's own
 * per-label handlers never fire. The stale closure is inert by construction
 * rather than by luck.
 */
HmiFormat = function() {};

HmiFormat.install = function()
{
	if (typeof Format === 'undefined' || Format.prototype.immediateRefresh == null)
	{
		HmiLog.warn('Format.immediateRefresh missing; Animation tab disabled');

		return;
	}

	var formatImmediateRefresh = Format.prototype.immediateRefresh;

	Format.prototype.immediateRefresh = function()
	{
		formatImmediateRefresh.apply(this, arguments);

		HmiLog.guard('animationTab', mxUtils.bind(this, function()
		{
			this.hmiAddAnimationTab();
		}));
	};
};

/**
 * Appends the Animation tab, then installs the router.
 */
Format.prototype.hmiAddAnimationTab = function()
{
	var ui = this.editorUi;
	var graph = ui.editor.graph;

	// Only the cells-selected branch gets the tab: there is nothing to
	// animate while editing text or with an empty selection.
	if (this.container.offsetWidth == 0 || graph.isEditing() ||
		graph.isSelectionEmpty())
	{
		return;
	}

	var titleContainer = this.container.firstChild;

	// Degrade quietly if upstream changed the DOM shape.
	if (titleContainer == null ||
		titleContainer.className != 'geFormatTitleContainer')
	{
		HmiLog.once('animationTab.shape',
			'unexpected format panel layout; Animation tab skipped');

		return;
	}

	var label = document.createElement('div');
	label.className = 'geFormatTitle';
	label.setAttribute('title', mxResources.get('hmiAnimation'));

	var title = document.createElement('div');
	mxUtils.write(title, mxResources.get('hmiAnimation'));
	label.appendChild(title);
	titleContainer.appendChild(label);

	var panel = document.createElement('div');
	panel.className = 'geFormatContent';
	panel.style.display = 'none';
	this.container.appendChild(panel);

	// Pushed so that Format.clear destroys it along with the stock panels.
	this.panels.push(new HmiFormatPanel(this, ui, panel));

	this.hmiInstallTabRouter(titleContainer);
};

/**
 * Takes over click routing for every tab in the strip.
 */
Format.prototype.hmiInstallTabRouter = function(titleContainer)
{
	var graph = this.editorUi.editor.graph;

	var labels = Array.prototype.slice.call(titleContainer.childNodes);

	// container.childNodes[0] is the title strip; the rest are the panels, in
	// the same order their labels were appended.
	var panels = Array.prototype.slice.call(this.container.childNodes, 1);

	if (labels.length != panels.length)
	{
		HmiLog.once('animationTab.align',
			'tab/panel count mismatch (' + labels.length + '/' + panels.length +
			'); leaving stock tabs alone');
		titleContainer.removeChild(labels[labels.length - 1]);
		this.container.removeChild(panels[panels.length - 1]);

		return;
	}

	var activate = mxUtils.bind(this, function(index)
	{
		for (var i = 0; i < panels.length; i++)
		{
			panels[i].style.display = (i == index) ? '' : 'none';

			if (i == index)
			{
				labels[i].classList.add('geActiveFormatTitle');
			}
			else
			{
				labels[i].classList.remove('geActiveFormatTitle');
			}
		}

		// Mirror upstream's tab memory so the choice survives reselection.
		if (graph.isSelectionEmpty())
		{
			this.diagramIndex = index;
		}
		else
		{
			this.currentIndex = index;
		}
	});

	mxEvent.addListener(titleContainer, 'click', mxUtils.bind(this, function(evt)
	{
		var elt = mxEvent.getSource(evt);

		while (elt != null && elt.parentNode != titleContainer)
		{
			elt = elt.parentNode;
		}

		var index = mxUtils.indexOf(labels, elt);

		if (index >= 0 && labels[index].style.display != 'none')
		{
			// Capture phase: upstream's own handlers never see this.
			mxEvent.consume(evt);
			activate(index);
		}
	}), true);

	// Restore the remembered tab, defaulting to Arrange (the last stock tab)
	// exactly as upstream's lastEntry=true does.
	var remembered = (graph.isSelectionEmpty()) ? this.diagramIndex : this.currentIndex;
	var fallback = Math.max(0, panels.length - 2);

	activate((remembered != null && remembered >= 0 &&
		remembered < panels.length &&
		labels[remembered].style.display != 'none') ? remembered : fallback);
};
