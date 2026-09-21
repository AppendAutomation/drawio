/**
 * In-app self test.
 *
 * Runs against a live EditorUi so that the assertions exercise the real
 * upstream save path, the real Format rebuild and the real mxCell codec --
 * the things a unit test with a mock would not catch.
 *
 * Enabled with ?hmitest=1 (the desktop shell passes query params through), or
 * by calling HmiSelfTest.run() from the console. Results go to the console
 * prefixed HMITEST so the harness can grep them.
 */
HmiSelfTest = function() {};

HmiSelfTest.results = [];

HmiSelfTest.check = function(name, condition, detail)
{
	HmiSelfTest.results.push({name: name, pass: !!condition, detail: detail});

	console.log('HMITEST ' + ((condition) ? 'PASS' : 'FAIL') + ' ' + name +
		((!condition && detail != null) ? ' :: ' + detail : ''));
};

HmiSelfTest.run = function(ui)
{
	ui = ui || window.App_ui || HmiSelfTest.ui;

	if (ui == null)
	{
		console.log('HMITEST FAIL harness :: no EditorUi');

		return;
	}

	HmiSelfTest.results = [];

	try
	{
		HmiSelfTest.testProjectRoundTrip();
		HmiSelfTest.testCellLinks(ui);
		HmiSelfTest.testFileRoundTrip(ui);
		HmiSelfTest.testFormatTab(ui);
	}
	catch (e)
	{
		console.log('HMITEST FAIL harness :: ' + e.message + ' @ ' + e.stack);
	}

	var failed = 0;

	for (var i = 0; i < HmiSelfTest.results.length; i++)
	{
		if (!HmiSelfTest.results[i].pass)
		{
			failed++;
		}
	}

	console.log('HMITEST DONE total=' + HmiSelfTest.results.length +
		' failed=' + failed);
};

// ------------------------------------------------------------- fixtures

HmiSelfTest.sampleProject = function()
{
	var p = new HmiProject();

	p.accessNames.push({id: 'PLC1', driver: 'simulator', node: '', topic: '',
		rateMs: 250});

	var level = HmiProject.createTag('Tank_Level', 'IOReal');
	level.comment = 'Day tank';
	level.engUnits = '%';
	level.access = 'PLC1';
	level.item = 'N7:0';
	level.alarms = {loLo: 5, low: 10, high: 90, hiHi: 95};
	level.sim = {mode: 'sine', periodMs: '30000'};
	p.addTag(level);

	p.addTag(HmiProject.createTag('Pump1_Run', 'MemoryDiscrete'));
	p.addTag(HmiProject.createTag('Recipe_Name', 'MemoryMessage'));

	return p;
};

// ---------------------------------------------------------------- tests

/** toXml -> fromXml -> toXml must be stable, or golden files are worthless. */
HmiSelfTest.testProjectRoundTrip = function()
{
	var doc = mxUtils.createXmlDocument();
	var p1 = HmiSelfTest.sampleProject();
	var x1 = mxUtils.getXml(p1.toXml(doc));

	var parsed = mxUtils.parseXml(x1);
	var p2 = HmiProject.fromXml(parsed.documentElement);
	var x2 = mxUtils.getXml(p2.toXml(doc));

	HmiSelfTest.check('project.roundTrip.stable', x1 === x2,
		'\n  first=' + x1 + '\n  second=' + x2);
	HmiSelfTest.check('project.roundTrip.tagCount', p2.tags.length === 3,
		'got ' + p2.tags.length);
	HmiSelfTest.check('project.roundTrip.alarms',
		p2.getTag('Tank_Level').alarms != null &&
		p2.getTag('Tank_Level').alarms.hiHi === 95);
	HmiSelfTest.check('project.lookup.caseInsensitive',
		p2.getTag('tank_level') != null);
};

/** Links must survive the mxCell codec untouched, including newlines. */
HmiSelfTest.testCellLinks = function(ui)
{
	var graph = ui.editor.graph;
	var parent = graph.getDefaultParent();
	var cell = null;

	graph.getModel().beginUpdate();

	try
	{
		cell = graph.insertVertex(parent, null, 'SelfTest', 20, 20, 80, 40);
	}
	finally
	{
		graph.getModel().endUpdate();
	}

	var links = {
		'fillColor.analog': {expr: 'Tank_Level',
			bands: [{max: 'Tank_Level.MaxEU * 0.9', color: '#00CC00'},
					{max: null, color: '#CC0000'}]},
		'pushbutton': {kind: 'discrete', tag: 'Pump1_Run', action: 'toggle',
			// A multi-line value is the case that flat XML attributes would
			// silently mangle, so it is asserted explicitly.
			enableExpr: 'A == 1;\nB == 2;'}
	};

	HmiProject.setCellLinks(graph, cell, links);

	var back = HmiProject.getCellLinks(graph, cell);

	HmiSelfTest.check('cell.links.expr',
		back['fillColor.analog'].expr === 'Tank_Level');
	HmiSelfTest.check('cell.links.bandExpression',
		back['fillColor.analog'].bands[0].max === 'Tank_Level.MaxEU * 0.9');
	HmiSelfTest.check('cell.links.terminalBandNull',
		back['fillColor.analog'].bands[1].max === null);
	HmiSelfTest.check('cell.links.newlinesPreserved',
		back['pushbutton'].enableExpr === 'A == 1;\nB == 2;',
		JSON.stringify(back['pushbutton'].enableExpr));

	// The cell value must have been promoted to an element node.
	HmiSelfTest.check('cell.links.userObject',
		cell.value != null && typeof cell.value === 'object');

	// Removing every link must remove the attribute, keeping clean cells clean.
	HmiProject.setCellLinks(graph, cell, {});
	HmiSelfTest.check('cell.links.cleared',
		graph.getAttributeForCell(cell, 'hmi', null) == null);

	HmiProject.setCellLinks(graph, cell, links);
	HmiSelfTest.testCell = cell;
};

/**
 * The load-bearing test: does <hmiProject> survive upstream's real save path?
 */
HmiSelfTest.testFileRoundTrip = function(ui)
{
	ui.hmiProject = HmiSelfTest.sampleProject();

	var data = ui.getFileData(true);

	HmiSelfTest.check('file.save.hmiVersion',
		data.indexOf('hmiVersion="1"') > 0);
	HmiSelfTest.check('file.save.hmiProject',
		data.indexOf('<hmiProject') > 0);
	HmiSelfTest.check('file.save.tagPresent',
		data.indexOf('Tank_Level') > 0);
	HmiSelfTest.check('file.save.cellAttribute',
		data.indexOf('hmi=') > 0, 'cell links missing from saved XML');

	// Exactly one dictionary, even after repeated saves.
	var again = ui.getFileData(true);
	var count = again.split('<hmiProject').length - 1;
	HmiSelfTest.check('file.save.singleDictionary', count === 1,
		'found ' + count);

	// And back in.
	ui.hmiProject = null;
	ui.setFileData(again);

	HmiSelfTest.check('file.load.project', ui.hmiProject != null);
	HmiSelfTest.check('file.load.tagCount',
		ui.hmiProject != null && ui.hmiProject.tags.length === 3,
		(ui.hmiProject != null) ? 'got ' + ui.hmiProject.tags.length : 'null');
	HmiSelfTest.check('file.load.ioFields',
		ui.hmiProject != null &&
		ui.hmiProject.getTag('Tank_Level') != null &&
		ui.hmiProject.getTag('Tank_Level').item === 'N7:0');

	// The detector: dictionary stripped but the marker left behind.
	var stripped = again.replace(/<hmiProject[\s\S]*?<\/hmiProject>/, '');
	ui.hmiProject = null;
	ui.setFileData(stripped);
	HmiSelfTest.check('file.load.lossDetected',
		ui.hmiProject != null && ui.hmiProject.isEmpty(),
		'expected an empty project plus a warning');
};

/** Spike 2: four tabs, and routing that does not strand the user. */
HmiSelfTest.testFormatTab = function(ui)
{
	var graph = ui.editor.graph;
	var format = ui.format;

	if (format == null || HmiSelfTest.testCell == null)
	{
		HmiSelfTest.check('format.available', false, 'no format panel');

		return;
	}

	graph.setSelectionCell(HmiSelfTest.testCell);
	format.immediateRefresh();

	var strip = format.container.firstChild;
	var labels = (strip != null) ? strip.childNodes : [];
	var panels = Array.prototype.slice.call(format.container.childNodes, 1);

	HmiSelfTest.check('format.tabCount', labels.length === 4,
		'got ' + labels.length);
	HmiSelfTest.check('format.panelCount', panels.length === 4,
		'got ' + panels.length);
	HmiSelfTest.check('format.animationLast',
		labels.length === 4 &&
		labels[3].getAttribute('title') === mxResources.get('hmiAnimation'));

	if (labels.length !== 4)
	{
		return;
	}

	function visibleCount()
	{
		var n = 0;

		for (var i = 0; i < panels.length; i++)
		{
			if (panels[i].style.display !== 'none')
			{
				n++;
			}
		}

		return n;
	}

	function activeIndex()
	{
		for (var i = 0; i < panels.length; i++)
		{
			if (panels[i].style.display !== 'none')
			{
				return i;
			}
		}

		return -1;
	}

	// Exactly one panel visible at rest.
	HmiSelfTest.check('format.oneVisibleInitially', visibleCount() === 1,
		'got ' + visibleCount());

	// Click every tab, then go back through them. The stale-closure bug shows
	// up as a click that does nothing after the Animation tab has been used.
	var order = [0, 1, 2, 3, 2, 1, 0, 3, 0];
	var ok = true;
	var detail = '';

	for (var i = 0; i < order.length; i++)
	{
		var idx = order[i];
		labels[idx].click();

		if (activeIndex() !== idx || visibleCount() !== 1)
		{
			ok = false;
			detail = 'clicking ' + idx + ' left active=' + activeIndex() +
				' visible=' + visibleCount();
			break;
		}
	}

	HmiSelfTest.check('format.routingStable', ok, detail);

	// The Animation panel must actually render its launcher.
	labels[3].click();
	HmiSelfTest.check('format.animationContent',
		panels[3].getElementsByClassName('hmiChip').length > 0,
		'no link chips rendered');
};
