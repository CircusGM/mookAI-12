import { Abort, Mook } from "./mook.js"
import { MinkowskiParameter } from "../../lib-find-the-path/scripts/point.js";
import { FTPUtility } from "../../lib-find-the-path/scripts/utility.js";
import { debugLog } from "./behaviors.js";

let mookAI;

function getDistanceMetric ()
{
	return MinkowskiParameter[game.settings.settings.get ("mookAI.DistanceMetric").choices[game.settings.get ("mookAI", "DistanceMetric")]];
}

export function initAI ()
{
	mookAI = new MookAI ();

	const mod = game.modules.get("mookAI");
	if (mod) {
		mod.api = mookAI;
	}

	game.settings.register ("mookAI", "DistanceMetric", {
		name: "Distance Metric",
		hint: "Distance on a grid can be measured multiple ways. Manhattan treats adjacent tiles as one unit away and diagonals as two. Chebyshev treats adjacent and diagonal tiles as one unit away. PF2E uses the 1-2-1-2 diagonal movement rule.",
		scope: "world",
		config: true,
		default: game.system.id === "pf2e" ? "PF2E" : "Chebyshev",
		type: String,
		choices: ["Chebyshev", "Euclidean", "Manhattan", "PF2E"],
	});

	game.settings.register ("mookAI", "MoveAnimationDelay", {
		name: "Move Animation Delay",
		hint: "Controls the amount of time between mook token movements. Measured in miliseconds.",
		scope: "world",
		config: true,
		default: "400",
		type: Number,
	});

	game.settings.register ("mookAI", "RotationAnimationDelay", {
		name: "Rotation Animation Delay",
		hint: "Controls the max delay between mook rotation and their next movement. Varies by amount turned. Measured in miliseconds.",
		scope: "world",
		config: true,
		default: "400",
		type: Number,
	});

	game.settings.register ("mookAI", "MookType", {
		name: "Mook Type",
		hint: "Controls how mooks behave. Eager Beavers attack the closest token, using range only when there are no mele targets. Shias attack a random target in range. This feature is not fully developed. Consult documentation for specifics.",
		scope: "world",
		config: true,
		default: "EAGER_BEAVER",
		type: String,
		choices: ["EAGER_BEAVER", "SHIA"],
	});

	game.settings.register ("mookAI", "AutoEndTurn", {
		name: "Automatically End Turn",
		hint: "If enabled, mookAI will advance the combat tracker after a mook acts. Otherwise, it will not.",
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
	});

	game.settings.register ("mookAI", "UseVision", {
		name: "Use Vision",
		hint: "If enabled, mooks will only attack enemies their tokens can see. If disabled, mooks have omniscient: they have full knowledge of the location of all tokens and the optimal path around/through all obstacles (such as mazes). Make sure that token vision is enabled and configured!",
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
	});

	game.settings.register ("mookAI", "MookOmniscience", {
		name: "Mook Omniscience",
		hint: "If enabled, mooks will always find the most direct path to a target, even if the path itself is obscured or otherwise hard to navigate. If disabled, the path a mook takes can only consist of tiles the mook could see before the mook started moving. For example, an omniscient mook could perfectly navigate a maze if they had vision on a target from the initial position.",
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
	});

	game.settings.register ("mookAI", "MookInitiative", {
		name: "Mook Initiative",
		hint: "Controls what mooks do when there is no target within range. They can do nothing, rotate in place, creep forward 1 tile at a time, or wander aimlessly (rotate + creep). If they find an enemy while \"exploring\" that is in range (after accounting for how far they have already moved), they will attack that target according to their configured behavior. In either case, they will pass their turn in combat afterward.",
		scope: "world",
		config: true,
		default: "WANDER",
		type: String,
		choices: ["DO_NOTHING", "ROTATE", "CREEP", "WANDER"],
	});

	game.settings.register ("mookAI", "DisableExploration", {
		name: "Mooks will not explore",
		hint: "If a mook cannot find a target, mookAI will stop without ending the turn.",
		scope: "world",
		config: true,
		default: false,
		type: Boolean
	});

	game.settings.register ("mookAI", "DisableRotation", {
		name: "Tokens will not rotate",
		hint: "If checked, mookAI will enable \"Lock Rotation\" in a token's settings before moving a mook. Afterward, it will return that setting to its initial value.",
		scope: "world",
		config: true,
		default: false,
		type: Boolean
	});

	game.settings.register ("mookAI", "ExploreAutomatically", {
		name: "Mooks explore automatically",
		hint: "If a mook cannot find a target, they will explore their environment without being directed.",
		scope: "world",
		config: true,
		default: true,
		type: Boolean
	});

	game.settings.register ("mookAI", "RotationCost", {
		name: "Rotation Cost",
		hint: "When exploring, mooks may end up rotating to search for heroes to die against. This setting controls how much movement, in tiles, each rotation costs. It can be set between 0.0 and 1.0 tiles unless the mook's initiative is set to \"Rotate.\" If the mook is configured to rotate, and the rotation cost is 0.0, then they will \"Do Nothing\" instead.",
		scope: "world",
		config: true,
		default: 0.2,
		type: Number,
	});

	game.settings.register ("mookAI", "UseMele", {
		name: "Mooks may use mele attacks",
		hint: "If enabled, mooks will check if they can make mele attacks. If disabled, they will not.",
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
	});

	game.settings.register ("mookAI", "UseRanged", {
		name: "Mooks may use ranged attacks",
		hint: "If enabled, mooks will check if they can make ranged attacks. If disabled, they will not.",
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
	});

	game.settings.register ("mookAI", "StandardMeleTileRange", {
		name: "Default mele weapon attack radius",
		hint: "Some mele weapons do not provide a max range. This setting, in units of tiles, is a fallback to allow mooks to attack in such instances. Setting this value to zero will prevent mooks from attacking with a ranged weapon that has no explicit range value. They will explore instead.",
		scope: "world",
		config: true,
		default: 1,
		type: Number,
	});

	game.settings.register ("mookAI", "StandardRangedTileRange", {
		name: "Default ranged weapon attack radius",
		hint: "Some ranged weapons do not provide a max range. This setting, in units of tiles, is a fallback to allow mooks to attack in such instances. Setting this value to zero will prevent mooks from attacking with a ranged weapon that has no explicit range value. They will explore instead.",
		scope: "world",
		config: true,
		default: 12,
		type: Number,
	});

	game.settings.register("mookAI", "SkipActionConfirmation", {
		name: "Skip Action Confirmation",
		hint: "If enabled, mooks will execute their actions without showing a confirmation dialog.",
		scope: "world",
		config: true,
		default: false,
		type: Boolean,
	});

	game.settings.register("mookAI", "AutoControlMooks", {
		name: "Automatically Control Mooks",
		hint: "If enabled, mookAI will automatically take control of mook turns without requiring the 'G' key press.",
		scope: "world",
		config: true,
		default: false,
		type: Boolean
	});

	game.settings.register("mookAI", "AutoControlLevel", {
		name: "Auto-Control Level Limit",
		hint: "Only automatically control mooks at or below this level. Set to 0 to control all levels.",
		scope: "world",
		config: true,
		default: 0,
		type: Number,
		range: {
			min: 0,
			max: 20,
			step: 1
		}
	});

	game.settings.register("mookAI", "IgnoreSpellcasters", {
		name: "Ignore Spellcasters",
		hint: "If enabled, mookAI will not automatically control creatures that can cast spells.",
		scope: "world",
		config: true,
		default: true,
		type: Boolean
	});

	game.settings.register("mookAI", "enableDebugConsoleMessages", {
		name: "Enable Debug Console Messages",
		hint: "If enabled, MookAI will output detailed debug messages to the console.",
		scope: "world",
		config: true,
		default: false,
		type: Boolean
	});

	Hooks.on ("ready", () => {
		try
		{
			if (! mookAI.ready ())
				mookAI = {};
		}
		catch (e_)
		{
			console.log ("mookAI | Failed to initialize:")
			console.log (e_)
		}
	});
}

export class MookAI
{
	constructor ()
	{
		this._busy = true;
		this._combats = new Map ();
		this.systemModels = {};
	}

	/**
	 * Registers a system-specific mook model.
	 * @param {string} systemId - The target game system id (e.g., "pf2e").
	 * @param {class} model - The class that implements the MookModel.
	 * @param {class} settings - The class corresponding to the model settings for that system.
	 */
	registerSystemModel(systemId, model, settings) {
		this.systemModels[systemId] = { model, settings };
		console.log(`mookAI | Registered system model for ${systemId}`);
	}

	ready ()
	{
		if (! game.user.isGM)
		{
			// todo?: let heroes have mooks
			console.log ("mookAI | Heroes don't have mooks; they have friends!");
			return false;
		}

		Hooks.on ("updateToken", (token_, changes_, diff_, sceneID_) => {
			if (! diff_?.diff)
				return;
		
			this.updateTokens (changes_);
		});

		// This seems undocumented? Maybe internal function
		Hooks.on ("createCombatant", (combatant_, config_, id_) => {
			try {
			//this.addCombatant (id_, combatant_.token.id);
			// using game.combat.id instead of id_ because id_ is not the combat id anymore???
			this.addCombatant (game.combat.id, combatant_.token.id);
			} catch (error) {
				console.error("Error in createCombatant hook:", error);
				console.error(error.stack);
			}
		});
		Hooks.on ("deleteCombatant", (combatant_, config_, id_) => {
			try {
				this.deleteCombatant (id_, combatant_.tokenId);
			} catch (error) {
				console.error("Error in deleteCombatant hook:", error);
				console.error(error.stack);
			}
		});
		Hooks.on ("createCombat", (combat_, config_, id_) => {
			try {
				this.combatStart (combat_);
			} catch (error) {
				console.error("Error in createCombat hook:", error);
				console.error(error.stack);
			}
		});
		Hooks.on ("deleteCombat", (combat_, config_, id_) => {
			try {
				this.combatEnd (combat_);
			} catch (error) {
				console.error("Error in deleteCombat hook:", error);
				console.error(error.stack);
			}
		});
		Hooks.on ("updateScene", (...args) => { 
			try {
				this.handleSceneChange () 
			} catch (error) {
				console.error("Error in updateScene hook:", error);
				console.error(error.stack);
			}
		});

		document.addEventListener('keyup', evt => {
			if (evt.key !== 'b' || ! evt.target.classList.contains ("game") || this.busy)
				return;

			game.combat.previousTurn ();
		});

		/*
		document.addEventListener('keyup', evt => {
			if (evt.key !== 't')
				return;

			console.time ("myTimer");
			const pm = game.FindThePath.Chebyshev.PathManager;

			(async () => {
				const points = await pm.pointsWithinRangeOfToken (canvas.tokens.placeables[0], 10);
				points.sort ((a, b) => {
					return 100 * (a.segment.point.x-b.segment.point.x)
						   + (a.segment.point.y - b.segment.point.y)
				});
				const segs = points.map (p => p.segment );
				const dists = points.map (p => p.dist );
				console.log (segs);
				console.log (dists);
				const ftpUtility = new FTPUtility ();
				ftpUtility.highlightSegments (segs);
			}) ();
			console.timeEnd ("myTimer");
		});
		*/

		document.addEventListener('keyup', evt => {
			if (evt.key !== 'n' || ! evt.target.classList.contains ("game") || this.busy)
				return;

			game.combat.nextTurn ();
		});

		if (game.modules.get("lib-find-the-path")?.active)
		{
			document.addEventListener('keyup', evt => {
				if (evt.key.toLowerCase () !== 'g' || ! evt.target.classList.contains ("game") || this.busy)
					return;
	
				if (evt.shiftKey)
					this.takeControlledTurns ();
				else if (evt.ctrlKey)
					this.takeNextTurn ();
				else if (evt.altKey)
					this.takeNextTurn ();
				else
					this.takeNextTurn ();
			});
		}
		else
		{
			const str = "mookAI | Missing module dependency: Library - Path Planning. Please check that it is installed and enabled. mookAI cannot automate without it."
			ui.notifications.notify (str, "error", { "permanent": true });
			console.log (str);
			return false;
		}

		this.metric = getDistanceMetric ();
		this._busy = false;
		return true;
	}

	handleSceneChange ()
	{
		this._combats = new Map ();
		this._busy = false;
	}
	
	addCombatant (combatId_, id_)
	{
		debugLog("addCombatant hook triggered: combatId:", combatId_);
		if (!this._combats.has(combatId_)) {
			debugLog("Combat id not found in _combats Map – initializing:", combatId_);
			this._combats.set(combatId_, new Map());
		}

		const mook = new Mook (canvas.tokens.get (id_), this.metric);
		this.combats.get (combatId_).set (id_, mook);
		debugLog("Completed addCombatant hook");
		return mook;
	}

	deleteCombatant (combat_, id_)
	{
		this.combats.get (combat_.id).delete (id_);
	}

	// Throws if there are no combats in the active scene
	async startCombats ()
	{
		debugLog("startCombats hook triggered:");
		game.combats.combats.forEach (c => { this.combatStart (c); });

		if (this._combats.size === 0)
		{
			ui.notifications.warn ("No combats in active scene.");
			throw "No combats in active scene";
		}

		await game.combat.activate ();
	}

	combatStart (combat_)
	{
		debugLog("combatStart called!");
		if (combat_.scene !== game.scenes.active.id)
			return;

		if (this.combats.get (combat_.id))
		{
			console.log ("mookAI | Attempted to start combat that is already active.");
			return;
		}

		let newMooks = new Map ();

		combat_.combatants.forEach (combatant => {
			const newToken = canvas.tokens.get (combatant.tokenId);

			if (! newToken)
			    return;

			newMooks.set (combatant.tokenId, new Mook (newToken, this.metric));
		});

		this._combats.set (combat_.id, newMooks);
	}

	combatEnd (combat_)
	{
		if (! this.combats.has (combat_.id))
		{
			console.log ("mookAI | Attempted to delete combat that does not exist.");
			return;
		}

		this.combats.delete (combat_.id);
	}

	async endTurn ()
	{
		if (! this.autoEndTurn)
			return;

		return await game.combat.nextTurn ().catch (err => {
			ui.notifications.warn (err);
		});
	}

	getCombat ()
	{
		debugLog("getCombat called. id: " + game.combat.id);
		return this.combats.get (game.combat.id);
	}

	getMook (combat_, tokenId_)
	{
		if (! combat_)
			throw "Invalid combat"

		if (! combat_.has (tokenId_))
			return this.addCombatant (game.combat.id, tokenId_);

		return combat_.get (tokenId_);
	}

	async takeNextTurn ()
	{
		this.applySettings ();
		debugLog("mookAI | take turn. Combats: " + this._combats.keys());
		debugLog("mookAI | take turn. Combats: " + this._combats.size);
		// Throws if there is not combat on the *active* scene
		if (this._combats.size === 0)
			await this.startCombats ();
		debugLog("mookAI | take turn. >0 combats");

		// Step 1: Get the current combat
		let combat;
		try {
			combat = this.getCombat();
			debugLog("Retrieved combat", combat);
		} catch (error) {
			console.error("Failed to get combat", error);
		}
		
		// Step 2: Get the current token ID
		let tokenId;
		try {
			tokenId = game.combat.current.tokenId;
			debugLog("Retrieved current token ID:", tokenId);
		} catch (error) {
			console.error("Error retrieving current token ID:", error);
		}
		
		// Step 3: Get the Mook instance
		let mook;
		try {
			mook = this.getMook(combat, tokenId);
			debugLog("Retrieved Mook instance:", mook);
		} catch (error) {
			console.error("Error retrieving Mook instance:", error);
		}
		
		// Step 4: Take the Mook's turn
		let success = false;
		if (mook) {
			try {
				success = await this.takeMookTurn(mook);
				debugLog("Mook turn success status:", success);
			} catch (error) {
				console.error("Error during Mook turn:", error);
			}
		} else {
			console.error("Mook instance undefined – cannot take turn");
		}
		
		if (success)
			this.endTurn ();
	}

	// Takes a turn for all selected tokens regardless of initiative
	async takeControlledTurns ()
	{
		this.applySettings ();

		if (this._combats.size === 0)
			await this.startCombats ();

		for (let token of canvas.tokens.controlled)
			await this.takeMookTurn (this.getMook (this.getCombat (), token.id));
	}

	async takeMookTurn (mook_)
	{
		try
		{
			if (! mook_)
			{
				ui.notifications.warn ("mookAI | Mook not found in scene. Please verify that the current scene is active.");
				throw "Failed to find mook (id: " + game.combat.current.tokenId + ") in scene (id: " + game.scenes.active.id + "). The most likely cause is that you are viewing an inactive scene. Please activate the scene before using mookAI. If the scene is already active, please submit a bug report!";
			}
	
			this._busy = true;
	
			debugLog("Starting mook turn...");
			await mook_.startTurn();
			debugLog("Completed startTurn");
	
			debugLog("Mook sensing...");
			await mook_.sense();
			debugLog("Completed sense");
	
			debugLog("Planning mook turn...");
			mook_.planTurn();
			debugLog("Completed planTurn");
	
			debugLog("Mook acting...");
			await mook_.act();
			debugLog("Completed act");
	
			debugLog("Ending mook turn...");
			await mook_.endTurn();
			debugLog("Completed endTurn");
	
			this._busy = false;
			return true;
		}
		catch (e) {
			if (!(e instanceof Error)) {
				e = new Error(e);
			}
	
			console.error("mookAI | Encountered unrecoverable error:");
			console.error("Error message:", e.message);
			console.error("Error name:", e.name);
			console.error("Error stack trace:", e.stack);

			if (!(e instanceof Abort)) {
				console.error("mookAI | Encountered unrecoverable error:");
				console.error("Error message:", e.message);
				console.error("Error name:", e.name);
				console.error("Error stack trace:", e.stack);
			} else {
				debugLog("mookAI | " + e.message);
			}
		
			if (mook_) {
				try {
					await mook_.cleanup();
				} catch (cleanupError) {
					console.error("mookAI | Error during cleanup:", cleanupError.message);
					console.error("Cleanup error stack trace:", cleanupError.stack);
				}
			}
			
			this._busy = false;
			return false;
		}
		
	}

	applySettings ()
	{
		this.changeMetric ();
	}

	changeMetric ()
	{
		const metric = getDistanceMetric ();

		if (this.metric === metric)
			return;
		
		this.metric = metric;
		this.combats.forEach ((mookMap, combatId) => {
			mookMap.forEach ((mook, mookId) => {
				this.addCombatant (combatId, mookId);
			});
		});
		
	}

	updateTokens (changes_)
	{
		this.combats.forEach (mooks => {
			mooks.forEach (m => { m.handleTokenUpdate (changes_); });
		});
	}

	get autoEndTurn () { return game.settings.get ("mookAI", "AutoEndTurn"); }

	// ;)
	get busy () { return this._busy; }

	get combats () { return this._combats; }

};

Hooks.on("updateCombat", async (combat, changed, options, userId) => {
	debugLog("updateCombat hook triggered");
	
	// Only proceed if we're the GM and there was a turn change
	if (!game.user.isGM || !changed.hasOwnProperty("turn")) {
		debugLog("Skipping - not GM or not turn change");
		return;
	}
	
	// Check if auto-control is enabled
	if (!game.settings.get("mookAI", "AutoControlMooks")) {
		debugLog("Debug: Auto-control is disabled");
		return;
	}

	const currentCombatant = combat.combatant;
	if (!currentCombatant) {
		debugLog("Debug: No current combatant");
		return;
	}

	const token = canvas.tokens.get(currentCombatant.tokenId);
	if (!token) {
		debugLog("Debug: Token not found");
		return;
	}

	debugLog("Debug: Processing token", token.name);

	// Skip if it's a player-owned token
	if (token.actor.hasPlayerOwner) {
		debugLog("Debug: Skipping player-owned token");
		return;
	}

	// Check level restriction if applicable
	const levelLimit = game.settings.get("mookAI", "AutoControlLevel");
	if (levelLimit > 0) {
		const creatureLevel = getCreatureLevel(token.actor);
		debugLog("Debug: Checking level", creatureLevel, "against limit", levelLimit);
		if (creatureLevel > levelLimit) {
			debugLog("Debug: Skipping - creature level too high");
			return;
		}
	}

	// Check spellcaster restriction if applicable
	if (game.settings.get("mookAI", "IgnoreSpellcasters")) {
		if (isSpellcaster(token.actor)) {
			debugLog("Debug: Skipping spellcaster");
			return;
		}
	}

	debugLog("Debug: Taking turn for", token.name);
	// If we've made it here, automatically take the turn
	await mookAI.takeNextTurn();
});

// Helper function to get creature level based on system
function getCreatureLevel(actor) {
	switch (game.system.id) {
		case "dnd5e":
			return actor.system.details.cr || 0;
		case "pf2e":
			return actor.system.details.level.value || 0;
		default:
			return 0;
	}
}

// Helper function to check if actor is a spellcaster
function isSpellcaster(actor) {
	switch (game.system.id) {
		case "dnd5e":
			// Only consider it a spellcaster if it has spell slots or spells with uses
			if (!actor.system.spells) {
				return false;
			}
			
			return Object.entries(actor.system.spells).some(([key, spellLevel]) => 
				spellLevel.value > 0 || spellLevel.max > 0
			);
			
		case "pf2e":
			// First check if spellcasting exists
			if (!actor.spellcasting) {
				return false;
			}

			// Then check if contents exists
			if (!actor.spellcasting.contents) {
				return false;
			}

			// Look through each spellcasting entry
			for (const entry of actor.spellcasting.contents) {
				// Check if entry and its system data exist
				if (!entry || !entry.system) {
					continue;
				}

				// If we find a tradition, this is a spellcaster
				if (entry.system.tradition) {
					return true;
				}
			}

			// If we got here, no valid spellcasting entries were found
			return false;

		default:
			return false;
	}
}
