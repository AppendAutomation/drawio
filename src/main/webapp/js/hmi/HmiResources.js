/**
 * Resource strings, registered at runtime so that upstream's
 * resources/dictionary.txt stays unpatched and out of the rebase surface.
 */
HmiResources = function() {};

HmiResources.install = function()
{
	// parse() splits on newlines, so the lines are joined rather than passed
	// as an array.
	mxResources.parse([
		'hmiAnimation=Animation',
		'hmiFileType=HMI Application',
		'hmiTagDictionary=Tag Dictionary',
		'hmiDevices=Devices',
		'hmiValidate=Validate Expressions',
		'hmiPublish=Publish',
		'hmiUserGuide=User Guide',
		'hmiReportProblem=Report a Problem',
		'hmiAbout=About Append HMI Studio',
		'hmiRun=Run',
		'hmiStop=Stop',
		'hmiRuntimeLog=Runtime Log',
		'hmiClearRetentive=Clear Retentive Values',
		'hmiAppSettings=Application Settings',
		'hmiWindowProps=Window Properties',
		// The menubar looks its label up by the menu's own name.
		'hmi=HMI',
		'hmiNoTags=Define at least one tag before running. Use HMI > Tag Dictionary.',
		'hmiRunningBanner=RUNNING — screen is live',
		'hmiSelectSingle=Select a single object to animate it.',
		'hmiNoLinks=No animation links on this object.',
		'hmiAddLink=Add animation link',
		'hmiRemoveLink=Remove this link',
		'hmiCopyAnimation=Copy Animation',
		'hmiPasteAnimation=Paste Animation',
		'hmiDeleteAnimation=Delete Animation',
		'hmiExpression=Expression',
		'hmiTag=Tag',
		'hmiEditBands=Edit Bands...',
		'hmiBands=Bands',
		'hmiOnColor=On color',
		'hmiOffColor=Off color',
		'hmiSense=Sense',
		'hmiVisible=Visible',
		'hmiInvisible=Invisible',
		'hmiRate=Rate (ms)',
		'hmiFormat=Format',
		'hmiPrefix=Prefix',
		'hmiSuffix=Suffix',
		'hmiAction=Action',
		'hmiEnableExpr=Enable when',
		'hmiPrompt=Prompt',
		'hmiKind=Kind',
		'hmiMin=Minimum',
		'hmiMax=Maximum',
		'hmiDictionaryLost=This file declares an HMI tag dictionary but does not ' +
			'contain one. It was most likely saved by an editor that does not ' +
			'support HMI application files, which discards the dictionary. Close ' +
			'without saving and restore from a backup to avoid losing it.'
	].join('\n'));
};
