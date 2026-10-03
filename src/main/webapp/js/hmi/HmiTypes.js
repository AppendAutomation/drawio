/**
 * Tag types, quality codes, and the animation link registry.
 *
 * The link registry is the single place that maps this fork's symbolic link
 * keys to the classic InTouch numeric codes (code = family * 100 + subtype).
 * The numeric code matters only at the InTouch import/export boundary;
 * everything else in the fork addresses links by their symbolic key so that
 * saved files stay readable and diffable.
 */
HmiTypes = function() {};

// ---------------------------------------------------------------- tag types

HmiTypes.TAG_TYPES = [
	'MemoryDiscrete', 'MemoryInteger', 'MemoryReal', 'MemoryMessage',
	'IODiscrete', 'IOInteger', 'IOReal', 'IOMessage'
];

HmiTypes.isIO = function(type)
{
	return type != null && type.indexOf('IO') === 0;
};

HmiTypes.isDiscrete = function(type)
{
	return type === 'MemoryDiscrete' || type === 'IODiscrete';
};

HmiTypes.isMessage = function(type)
{
	return type === 'MemoryMessage' || type === 'IOMessage';
};

HmiTypes.isAnalog = function(type)
{
	return type != null && !HmiTypes.isDiscrete(type) && !HmiTypes.isMessage(type);
};

/** True for types whose value is a whole number. */
HmiTypes.isInteger = function(type)
{
	return type === 'MemoryInteger' || type === 'IOInteger';
};

// ------------------------------------------------------------------ quality
// OPC DA scale. Deliberately numeric and ordered so that propagating the
// minimum across an expression's operands gives the semantics an HMI needs:
// any input bad makes the whole result bad.

HmiTypes.QUALITY_BAD = 0;
HmiTypes.QUALITY_UNCERTAIN = 64;
HmiTypes.QUALITY_GOOD = 192;

HmiTypes.qualityName = function(q)
{
	return (q >= HmiTypes.QUALITY_GOOD) ? 'Good' :
		((q >= HmiTypes.QUALITY_UNCERTAIN) ? 'Uncertain' : 'Bad');
};

// -------------------------------------------------------------- dot fields
// Fields readable off a tag reference. Anything not listed here is a compile
// error rather than a runtime surprise.

HmiTypes.DOTFIELDS = {
	'Value': true, 'Name': true, 'Quality': true, 'TimeDate': true,
	'MinEU': true, 'MaxEU': true, 'MinRaw': true, 'MaxRaw': true,
	'EngUnits': true, 'Comment': true,
	'InAlarm': true, 'AlarmMostUrgentInAlarm': true, 'Acked': true
};

// ------------------------------------------------------------ system tags
// Supplied by the runtime rather than the dictionary. The names are reserved:
// no dictionary tag may take one.

HmiTypes.SYSTEM_TAGS = {
	'_AlarmsActive': {type: 'MemoryInteger', readOnly: true,
		comment: 'Number of active alarms'},
	'_AlarmsUnacked': {type: 'MemoryInteger', readOnly: true,
		comment: 'Number of unacknowledged alarms'},
	'_AckAll': {type: 'MemoryDiscrete', readOnly: false,
		comment: 'Write 1 to acknowledge all alarms'},
	'_Username': {type: 'MemoryMessage', readOnly: true,
		comment: 'The logged-in user, "None" when nobody is'},
	'_AccessLevel': {type: 'MemoryInteger', readOnly: true,
		comment: "The logged-in user's access level, 0 when nobody is"}
};

/** The system tag's canonical name, or null. Case-insensitive like tag names. */
HmiTypes.systemTag = function(name)
{
	if (typeof name !== 'string')
	{
		return null;
	}

	var lower = name.toLowerCase();

	for (var key in HmiTypes.SYSTEM_TAGS)
	{
		if (key.toLowerCase() === lower)
		{
			return key;
		}
	}

	return null;
};

// ------------------------------------------------------- link type registry

/**
 * Link families, in the order the Animation panel's launcher shows them.
 */
HmiTypes.FAMILIES = [
	{id: 'touch', label: 'Touch Links'},
	{id: 'lineColor', label: 'Line Color'},
	{id: 'fillColor', label: 'Fill Color'},
	{id: 'textColor', label: 'Text Color'},
	{id: 'movement', label: 'Value / Movement'},
	{id: 'display', label: 'Miscellaneous'},
	{id: 'value', label: 'Value Display'}
];

/**
 * key -> {code, family, label, milestone, defaults()}
 *
 * `milestone` marks which types are wired end to end in M1; later types are
 * registered here so the numeric mapping stays in one place, but the panel
 * only offers those whose milestone is <= HmiTypes.MILESTONE.
 */
HmiTypes.MILESTONE = 2;

HmiTypes.LINKS = {};

HmiTypes.defineLink = function(key, def)
{
	def.key = key;
	HmiTypes.LINKS[key] = def;

	return def;
};

(function()
{
	var def = HmiTypes.defineLink;

	// --- colour links. Discrete takes two colours; analog takes a variable
	// --- length band array (see HmiProject for why it is not fixed at 10).

	function discreteColor(key, code, family, label)
	{
		def(key, {code: code, family: family, label: label, milestone: 1,
			defaults: function()
			{
				return {expr: '', on: '#00CC00', off: '#808080'};
			}});
	}

	function analogColor(key, code, family, label)
	{
		def(key, {code: code, family: family, label: label, milestone: 1,
			defaults: function()
			{
				return {expr: '', bands: [
					{max: '50', color: '#00CC00'},
					{max: null, color: '#CC0000'}
				]};
			}});
	}

	discreteColor('lineColor.discrete', 201, 'lineColor', 'Line Color / Discrete');
	analogColor('lineColor.analog', 202, 'lineColor', 'Line Color / Analog');
	discreteColor('fillColor.discrete', 301, 'fillColor', 'Fill Color / Discrete');
	analogColor('fillColor.analog', 302, 'fillColor', 'Fill Color / Analog');
	discreteColor('textColor.discrete', 801, 'textColor', 'Text Color / Discrete');
	analogColor('textColor.analog', 802, 'textColor', 'Text Color / Analog');

	// Alarm colour variants are M2; registered for code fidelity only.
	def('lineColor.discreteAlarm', {code: 203, family: 'lineColor', label: 'Line Color / Discrete Alarm', milestone: 2,
		defaults: function()
		{
			return {tag: '', on: '#CC0000', off: '#808080'};
		}});
	def('lineColor.analogAlarm', {code: 204, family: 'lineColor', label: 'Line Color / Analog Alarm', milestone: 2,
		defaults: function()
		{
			return {tag: '', loLo: '#CC0000', low: '#CC8800',
				normal: '#00CC00', high: '#CC8800', hiHi: '#CC0000'};
		}});
	def('fillColor.discreteAlarm', {code: 303, family: 'fillColor', label: 'Fill Color / Discrete Alarm', milestone: 2,
		defaults: function()
		{
			return {tag: '', on: '#CC0000', off: '#808080'};
		}});
	def('fillColor.analogAlarm', {code: 304, family: 'fillColor', label: 'Fill Color / Analog Alarm', milestone: 2,
		defaults: function()
		{
			return {tag: '', loLo: '#CC0000', low: '#CC8800',
				normal: '#00CC00', high: '#CC8800', hiHi: '#CC0000'};
		}});
	def('textColor.discreteAlarm', {code: 803, family: 'textColor', label: 'Text Color / Discrete Alarm', milestone: 2,
		defaults: function()
		{
			return {tag: '', on: '#CC0000', off: '#808080'};
		}});
	def('textColor.analogAlarm', {code: 804, family: 'textColor', label: 'Text Color / Analog Alarm', milestone: 2,
		defaults: function()
		{
			return {tag: '', loLo: '#CC0000', low: '#CC8800',
				normal: '#00CC00', high: '#CC8800', hiHi: '#CC0000'};
		}});

	// --- miscellaneous display

	def('visibility', {code: 581, family: 'display', label: 'Visibility', milestone: 1,
		defaults: function()
		{
			return {expr: '', sense: 'visible'};
		}});

	def('blink', {code: 583, family: 'display', label: 'Blink', milestone: 1,
		defaults: function()
		{
			return {expr: '', rateMs: '500', attrs: ['fill'],
				fill: '#FF0000', line: '#FFFFFF', text: '#000000', blank: false};
		}});

	// Enable gates every touch link on the object, in the Visibility style:
	// enabled while the expression is true (or false, with sense 'disabled')
	def('enable', {code: 586, family: 'display', label: 'Enable', milestone: 2,
		defaults: function()
		{
			return {expr: '', sense: 'enabled'};
		}});

	// The Recipe List object's settings (HmiRecipes.js): edited in its own
	// section, never offered as a link
	def('recipeList', {code: 9001, family: 'display', label: 'Recipe List', milestone: 99,
		defaults: function()
		{
			return {book: '', title: '', selectedTag: '', upTag: '', downTag: '', arrows: false};
		}});

	// Superseded by Enable; still applied in existing projects, not offered
	def('disable', {code: 585, family: 'display', label: 'Disable', milestone: 99,
		defaults: function()
		{
			return {expr: ''};
		}});

	// --- value display

	def('valueDisplay', {code: 611, family: 'value', label: 'Value Display', milestone: 1,
		defaults: function()
		{
			return {kind: 'analog', expr: '', format: '0.0', prefix: '',
				suffix: '', onText: '', offText: ''};
		}});

	// --- touch links

	def('userInput', {code: 608, family: 'touch', label: 'User Input', milestone: 1,
		defaults: function()
		{
			return {kind: 'analog', tag: '', min: '', max: '',
				prompt: 'Enter value', keypad: true, masked: false};
		}});

	def('pushbutton', {code: 401, family: 'touch', label: 'Pushbutton', milestone: 1,
		defaults: function()
		{
			return {kind: 'discrete', tag: '', action: 'toggle', enableExpr: ''};
		}});

	def('pushbutton.action', {code: 402, family: 'touch', label: 'Action Script',
		milestone: 2,
		defaults: function()
		{
			return {onDown: '', whileDown: '', onUp: '', everyMs: '1000'};
		}});

	def('showWindow', {code: 403, family: 'touch', label: 'Show Window',
		milestone: 2,
		defaults: function()
		{
			return {window: '', enableExpr: ''};
		}});

	def('hideWindow', {code: 404, family: 'touch', label: 'Hide Window',
		milestone: 2,
		defaults: function()
		{
			return {window: '', enableExpr: ''};
		}});

	function slider(key, code, label)
	{
		def(key, {code: code, family: 'touch', label: label, milestone: 2,
			defaults: function()
			{
				return {tag: '', atMin: '0', atMax: '100',
					travelMin: '0', travelMax: '100'};
			}});
	}

	slider('slider.horizontal', 501, 'Slider / Horizontal');
	slider('slider.vertical', 511, 'Slider / Vertical');

	// --- geometry, all M2

	// The value/movement family. Every bound is an expression, so a range can
	// track the dictionary rather than being frozen at design time.
	function ranged(key, code, family, label, outMin, outMax, a, b, extra)
	{
		def(key, {code: code, family: family, label: label, milestone: 2,
			outMin: outMin, outMax: outMax, extra: extra,
			defaults: function()
			{
				var cfg = {expr: '', atMin: '0', atMax: '100'};
				cfg[outMin] = '' + a;
				cfg[outMax] = '' + b;

				for (var k in (extra || {}))
				{
					cfg[k] = extra[k];
				}

				return cfg;
			}});
	}

	ranged('location.horizontal', 521, 'movement', 'Location / Horizontal',
		'offsetMin', 'offsetMax', -100, 100);
	ranged('location.vertical', 531, 'movement', 'Location / Vertical',
		'offsetMin', 'offsetMax', -100, 100);
	// Size links also carry an anchor: the edge that stays put as the object
	// grows. InTouch always scales from the top-left; a bargraph usually wants
	// to grow upward instead, so the edge is a choice here.
	ranged('size.width', 541, 'movement', 'Object Size / Width',
		'pctMin', 'pctMax', 0, 100, {anchor: 'left'});
	ranged('size.height', 551, 'movement', 'Object Size / Height',
		'pctMin', 'pctMax', 0, 100, {anchor: 'top'});
	ranged('percentFill.horizontal', 561, 'movement', 'Percent Fill / Horizontal',
		'pctMin', 'pctMax', 0, 100);
	ranged('percentFill.vertical', 571, 'movement', 'Percent Fill / Vertical',
		'pctMin', 'pctMax', 0, 100);
	ranged('orientation', 720, 'movement', 'Orientation',
		'angleMin', 'angleMax', 0, 360);
})();

/** Link keys available in the current milestone, in registry order. */
HmiTypes.availableLinks = function()
{
	var res = [];

	for (var key in HmiTypes.LINKS)
	{
		if (HmiTypes.LINKS[key].milestone <= HmiTypes.MILESTONE)
		{
			res.push(HmiTypes.LINKS[key]);
		}
	}

	return res;
};

/** Reverse lookup for the InTouch importer. */
HmiTypes.linkByCode = function(code)
{
	for (var key in HmiTypes.LINKS)
	{
		if (HmiTypes.LINKS[key].code === code)
		{
			return HmiTypes.LINKS[key];
		}
	}

	return null;
};
