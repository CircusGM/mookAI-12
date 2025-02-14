import { MookTypes, getMookType, debugLog } from "./behaviors.js"
import { Mook } from "./mook.js";

// Controls what a mook does when their are no viable targets
export const MookInitiative = 
{
	// Mook ends their turn
	DO_NOTHING: 0,
	// Mook spins in place randomly
	ROTATE: 1,
	// Mook moves in a line
	// todo: Make mooks avoid walls
	CREEP: 2,
	// Mook spins in place randomly
	// todo: Make mooks avoid walls
	WANDER: 3,
}

// Add a helper function to convert numeric setting to enum value
function getMookInitiativeFromSetting(value) {
	// Convert string to number if needed
	const numValue = parseInt(value);
	
	// Find the matching enum value
	for (const [key, val] of Object.entries(MookInitiative)) {
		if (val === numValue) {
			debugLog(`Debug: Converting initiative setting ${value} to ${key}`);
			return MookInitiative[key];
		}
	}
	
	// Default to CREEP if invalid value
	console.warn(`Invalid MookInitiative value: ${value}, defaulting to CREEP`);
	return MookInitiative.CREEP;
}

// Deprecated / bugged?
function settingIndexToString(settingKey, configKey) {
	// Get the array of choices for the setting
	const choices = game.settings.settings.get(settingKey).choices;
	
	// Get the current value of the setting
	const currentValue = game.settings.get("mookAI-12", configKey);
	
	// Return the string representation of the current value
	return choices[currentValue];
}

// todo: stack behaviors? Probability distribution?
export class MookModelSettings
{
	constructor (token_)
	{
		// todo: Use the token's actor to access individualized mook settings
		const actor = token_.actor;

		this.mookType = getMookType (game.settings.get ("mookAI-12", "MookType"));

		// false indicates "do not automate this token"
		// todo: default false when actor-level configuration is available
		this.useAI = "true";

		this.useMele = game.settings.get ("mookAI-12", "UseMele");
		this.useRanged = game.settings.get ("mookAI-12", "UseRanged");
		// false indicates that the mook can see everyone
		this.useSight = game.settings.get ("mookAI-12", "UseVision");
		this.rotationCost = game.settings.get ("mookAI-12", "RotationCost"); 

		// Get the string representation of the MookInitiative setting
		// const initiativeString = settingIndexToString("mookAI-12.MookInitiative", "MookInitiative");
		const initiativeValue = game.settings.get("mookAI-12", "MookInitiative");
		debugLog("Debug: Got initiative setting", initiativeValue);
		this.mookInitiative = getMookInitiativeFromSetting(initiativeValue);
		debugLog("Debug: Set mookInitiative to", this.mookInitiative);

		if (this.mookInitiative === MookInitiative.ROTATE && this.rotationCost === 0)
			this.mookInitiative = MookInitiative.DO_NOTHING;

		if (this.rotationCost < 0) this.rotationCost = 0;
		if (this.rotationCost > 1) this.rotationCost = 1;

		// todo: When I get configuration working, mooks won't attack members of the same faction (probably checking for substrings: a goblin cultist might not attack other goblins or other cultists). Right now, mooks only attack PCs.
		this.faction = "hostile";
		// An override to the above. Some tokens, such as light sources, vehicles, etc. should not be attacked.
		// false indicates "mooks should not attack this token"
		// todo: default false when configuration works
		this.attackable = "true";

		// The max weapon distance, in tiles, if not provided by a weapon
		this.standardMeleWeaponTileRange = game.settings.get ("mookAI-12", "StandardMeleTileRange");
		if (this.standardMeleWeaponTileRange < 0) this.standardMeleWeaponTileRange = 1;
		this.standardRangedWeaponTileRange = game.settings.get ("mookAI-12", "StandardRangedTileRange");
		if (this.standardRangedWeaponTileRange < 0) this.standardRangedWeaponTileRange = 12;

		/* todo? Configure token vision from configuration page
		this.visionAngle = 360;
		this.visionRange = Infinity;
		*/
	}
};

export class MookModelSettings5e extends MookModelSettings
{
	constructor (token_)
	{
		super (token_);

		this.actionsPerTurn = 1;
		this.attacksPerAction = 1;

		this.hasBonusAttack = false;
		this.attacksPerBonusAction = 1;
		this.hasFreeAttack = false;
		this.attacksPerFreeAction = 1;

		this.useDashAction = true;

		this.dashActionsPerTurn = 1;
		this.hasDashBonusAction = false;
		this.hasDashFreeAction = false;
	}
};

