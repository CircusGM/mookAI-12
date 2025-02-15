import { Behaviors, MookTypes, Target } from "./behaviors.js"
import { ActionType, MookModel } from "./mookModel.js";
import { PathManager } from "../../lib-find-the-path-12/scripts/pathManager.js";
import { PointFactory, SquareNeighborAngles, AngleTypes } from "../../lib-find-the-path-12/scripts/point.js";
import { FTPUtility } from "../../lib-find-the-path-12/scripts/utility.js";
import { debugLog } from "./behaviors.js";

export class Abort extends Error
{
	constructor (...params)
	{
		super (...params);
		if (Error.captureStackTrace) { Error.captureStackTrace (this, Abort) }
		this.name = "Abort"
	}
};

// Wrapper around FVTT token class
export class Mook {
    constructor(token_, metric_) {
        debugLog("Debug 1: Entering Mook constructor");

        this._token = token_;
        debugLog("Debug 2: Token assigned", this._token);

        if (!this._token) {
            debugLog("Debug 3: Token not found, throwing Abort");
            throw new Abort(`Token with id ${token_.id} was not found`);
        }

        debugLog("Debug 4: Creating PointFactory");
        this._pointFactory = new PointFactory(metric_);
        debugLog("Debug 5: Creating PathManager");
        this._pathManager = new PathManager(metric_);

        debugLog("Debug 6: Getting MookModel");
        this._mookModel = MookModel.getMookModel(token_);
        debugLog("Debug 7: MookModel obtained", this._mookModel);

        debugLog("Debug 8: Creating start segment from token");
        this._start = this._pointFactory.segmentFromToken(token_);
        this._segment = this._start;
        debugLog("Debug 9: Start segment created", this._start);

        debugLog("Debug 10: Initializing arrays");
        this._targetedTokens = new Array();
        this._visibleTargets = new Array();

        debugLog("Debug 11: Setting time from mookModel");
		// "time" represents how much a mook can do on their turn. Moving a tile costs 1 time unit by default.
		// todo: replace with a generalized cross-system resource manager (?!)
        this._time = this.mookModel.time;

		// Array of Actions
        this._plan = new Array();

        debugLog("Debug 12: Setting collision and pathManager configurations");
        this._collisionConfig = { checkCollision: true, whitelist: new Array(token_) };
        this._pathManagerConfig = {
            collision: this._collisionConfig,
            priorityMeasure: null,
            constrainVision: true
        };

        debugLog("Debug 13: Creating FTPUtility");
        this.utility = new FTPUtility({
            token: token_,
            collisionConfig: this._collisionConfig
        });

        this.pcWarning = "<p style=\"color:red\">Warning: Token is owned by a player!</p>";

        debugLog("Debug 14: Mook constructor finished");
    }

	async startTurn() {
        debugLog("Debug 15: Entering startTurn");
		// Need to take control in order to check token's vision
        this.takeControl();
        this.mookModel.startTurn();

        debugLog("Debug 16: Updating start segment");
        this._start = this._pointFactory.segmentFromToken(this.token);
        this._segment = this._start;

        debugLog("Debug 17: Checking if mook is an explorer");
        this._isExplorer = this.isExplorer;

        debugLog("Debug 18: Setting time");
        this.time = this.mookModel.time;
        this._visibleTargets.splice(0);

        if (this.rotationDisabled) {
            debugLog("Debug 19: Locking rotation");
            await this.lockRotation();
        }
        debugLog("Debug 20: Exiting startTurn");
    }

	async sense ()
	{
		debugLog("Debug 21: starting sense");
		debugLog("Debug 21a: Current visible targets:", this._visibleTargets);
		this.pathManager.clearAll ();

		this._visibleTargets = game.combat.combatants.filter (combatant => {
			const id = combatant.tokenId;
			debugLog("Debug 21b: Checking combatant:", id);

			// Even mooks won't target themselves on purpose
			if (id === this.token.id) {
				debugLog("Debug 21c: Skipping self");
				return false;
			}

			const token = canvas.tokens.get (id);
			debugLog("Debug 21d: Found token:", token);

			// todo: add "factions" to allow targeting of npcs
			if (! this.isPC (token)) {
				debugLog("Debug 21e: Skipping non-PC token");
				return false;
			}
			// This shouldn't be possible
			if (! token.inCombat) {
				debugLog("Debug 21f: Skipping token not in combat");
				return false;
			}
			// Don't attack downed PCs
			if (this.mookModel.getCurrentHealth (token) <= 0) {
				debugLog("Debug 21g: Skipping downed PC");
				return false;
			}
			// If the mook doesn't have vision, then it can see everyone. This choice avoids many problems.
			if (this.mookModel.hasVision && ! this.canSee (token.id)) {
				debugLog("Debug 21h: Cannot see token");
				return false;
			}

			debugLog("Debug 21i: Valid target found:", token);
			return true;
		}).map (c => { return canvas.tokens.get (c.tokenId); });

		debugLog("Debug 21j: Final visible targets:", this._visibleTargets);

		// Todo: compute paths between tokens when one moves and then select paths here. 
		for (let t of this.visibleTargets)
		{
			debugLog("Debug 21k: Computing path to target:", t);
			await this.pathManager.addToken (this.token, t, this.time, this.pathManagerConfig);
		}
	}

	planTurn ()
	{
		debugLog("Debug 22: starting planTurn");
		// Clear the previous plan
		this.plan.splice (0);

		debugLog("Debug 22a: Visible targets count:", this.visibleTargets.length);
		if (this.visibleTargets.length === 0)
		{
			debugLog("Debug 22b: No visible targets found");
			if (this.time < 1)
			{
				debugLog("Debug 22c: Insufficient time, halting");
				this.plan.push (this.mookModel.haltAction ());
				return;
			}

			// Add debug logging for exploration settings
			debugLog("Debug 22d: Planning exploration", {
				isExploreDisabled: this.isExploreDisabled,
				mookInitiative: this.mookModel.settings.mookInitiative,
				isExplorer: this.isExplorer
			});

			// Only add EXPLORE action if exploration is enabled
			if (!this.isExploreDisabled) {
				this.plan.push({ actionType: ActionType.EXPLORE });
				this.plan.push(this.mookModel.senseAction());
				this.plan.push(this.mookModel.planAction());
			} else {
				debugLog("Debug 22e: Exploration is disabled, halting");
				this.plan.push(this.mookModel.haltAction());
			}
			return;
		}

		const targets = this.viableTargets;
		debugLog("Debug 22e: Viable targets:", targets);

		if (targets === null && this.visibleTargets.length > 0) {
			debugLog("Debug 22f: No viable targets found, but have visible targets");
			
			// Find closest visible target
			const closestTarget = Behaviors.getSmallest(this.visibleTargets, t => {
				return this.pathManager.path(this.token.id, t.id).cost;
			});

			if (closestTarget) {
				debugLog("Debug 22g: Moving towards closest visible target:", closestTarget.name);
				// Face the target
				this.plan.push(this.mookModel.faceAction(closestTarget));
				// Step towards them
				this.plan.push(this.mookModel.stepAction());
				// Sense and replan after movement
				this.plan.push(this.mookModel.senseAction());
				this.plan.push(this.mookModel.planAction());
				return;
			}

			// Only fall back to exploration if we couldn't find a path to any visible target
			if (this.mookModel.canZoom) {
				debugLog("Debug 22h: Attempting to zoom");
				const bonusTime = this.mookModel.zoom ();
				this.time += bonusTime;

				this.plan.push (this.mookModel.senseAction ());
				this.plan.push (this.mookModel.planAction ());
				return;
			}

			// If a mook can't find a target, they will explore to try to find one
			debugLog("Debug 22i: Planning exploration due to no viable targets");
			this.plan.push ({ actionType: ActionType.EXPLORE });
			this.plan.push (this.mookModel.senseAction ());
			this.plan.push (this.mookModel.planAction ());
			return;
		}

		// Of type Target
		const target = Behaviors.chooseTarget(this, targets);
		debugLog("Debug 22j: Chosen target:", target);

		this.plan.push ({
			actionType: ActionType.TARGET,
			data: { "target": target.token },
		});

		const path = this.pathManager.path (this.token.id, target.id);
		debugLog("Debug 22k: Path to target:", path);

		if (path.valid)
		{
			debugLog("Debug 22l: Valid path found, planning traverse");
			// Get the sub-path that ends within the desired attack range
			// This gets the actual Node object so that it has the distTraveled property
			const subpath = path.path.filter(n => n.distToDest >= target.range);
			// If no movement is needed, cost is 0; otherwise, 
			// use the distTraveled of the *last* node for the actual PF2e cost.
			let cost = path.within (target.range).length - 1;
			if (subpath.length > 0) {
			  cost = subpath[subpath.length - 1].distTraveled; 
			}
			this.plan.push ({
				actionType: ActionType.TRAVERSE,
				cost: cost,
				data: { "path": path, "dist": target.range }
			});
		}
		else
		{
			debugLog("Debug 22m: No valid path found");
			this.plan.push ({
				actionType: ActionType.TRAVERSE,
				cost: 0,
				data: { "path": null, "dist": target.range }
			});
		}

		debugLog("Debug 22n: Planning face action");
		this.plan.push (this.mookModel.faceAction (target.token));

		debugLog("Debug 22o: Planning attack action");
		this.plan.push (target.attackAction);

		debugLog("Debug 22p: Planning halt action");
		this.plan.push (this.mookModel.haltAction ());
	}

	async act ()
	{
		try {

		
		debugLog("Debug 23: starting act");
		debugLog("Acting. Time: %f", this.time);

		// todo: Setting to disable
		// TODO reable camera tracking
		//await this.centerCamera ();

		// todo: true timer
		let tries = 100;
		while (this.time >= 0 && --tries)
		{
			debugLog("Try #%f", 100 - tries);

			if (this.plan.length === 0)
			{
				console.log ("mookAI | Planning failure: empty plan.");
				return;
			}

			if (this.plan.reduce (a => a?.cost) > this.time)
			{
				if (this.mookModel.canZoom)
				{
					this.time += this.mookModel.zoom ();
					continue;
				}

				console.log ("mookAI | Planning failure: too ambitious.");
				return;
			}

			let action = this.plan.splice (0, 1)[0];

			debugLog(action);

			switch (action.actionType)
			{
			case (ActionType.HALT):
				debugLog("Halting");
				this.cleanup ();
				return;
			case (ActionType.SENSE):
				debugLog("Sensing");
				await this.sense ();
				break;
			case (ActionType.PLAN):
				debugLog("Planning");
				this.planTurn ();
				break;
			case (ActionType.ROTATE):
				debugLog("Rotating");
				await this.rotate (action.data);
				break;
			case (ActionType.FACE):
				debugLog("Rotating to face target");
				await this.rotate (this.degreesToTarget (action.data));
				break;
			case (ActionType.MOVE):
				debugLog("Moving from (%f, %f) to (%f, %f)",
						this.point.x, this.point.y, action.data.x, action.data.y);
				const success = await this.move(action.data);
				if (success) {
					const tilesMoved = 1; // TODO calculate dist but this probably isn't used anywhere. 
					this.mookModel.recordMovement(tilesMoved);
				}
				break;
			case (ActionType.EXPLORE):
				if (this.isExploreDisabled)
					this.handleFailure (new Abort ("Not taking turn. Mook found no targets and exploration is disabled."));

				debugLog("Exploring");

				if (! this._isExplorer)
				{
					let dialogContent = "<p>The mook could not find a target. This could be because they don't have vision on a PC or because they are outside of weapon range.</p><p>The mook can explore their environment and try to find a target. Otherwise, mookAI will return control to the user.</p>";

							if (this.token.actor.hasPlayerOwner)
								dialogContent = this.pcWarning + dialogContent;

					let dialogPromise = new Promise ((resolve, reject) => {
						const dialog = new Dialog ({
							title: "Mook wants to explore!",
							content: dialogContent,
							buttons: {
								approve: {
									label: game.i18n.localize ("Explore"),
									callback: () => { resolve (); }
								},
								reject: {
									label: game.i18n.localize ("Assume Direct Control"),
									callback: () => { reject (); }
								}
							},
							default: "approve",
							close: reject
						});
	
						dialog.render (true);
						dialog.position.top = 120;
						dialog.position.left = 120;
					});

					try {
						await dialogPromise;
					}
					catch (error)
					{
						this.handleFailure (new Abort ("Mook not exploring; out of actions."));
					}

							this._isExplorer = true;
						}

				const exploreActions = this.mookModel.exploreActions ();
				for (let i = 0; i < exploreActions.length; ++i)
					this.plan.splice (i, 0, exploreActions[i]);
				break;
			case (ActionType.TARGET):
				debugLog("Targeting");
				this.target (action.data.target);
				break;
			case (ActionType.ATTACK):
				debugLog("Attacking!");
				while (this.mookModel.canAttack) { await this.mookModel.attack (action); }
				break;
			case (ActionType.STEP):
				debugLog("Stepping");
				const stepped = await this.step();
				if (stepped) {
					const tilesMoved = 1; // A single step is one tile
					this.mookModel.recordMovement(tilesMoved);
				} else {
					this.handleFailure (new Error ("Failed to take step"));
				}
				break;
			case (ActionType.TRAVERSE):
				debugLog("Traversing");

				if (action.cost > 0)
				{
					this.utility.path = action.data.path;
					this.utility.highlightPoints (action.data.path.path.map (s => s.origin));
				}

				if (!game.settings.get("mookAI-12", "SkipActionConfirmation")) {
					let dialogContent = "<p>Take action?</p>";

					if (this.token.actor.hasPlayerOwner)
						dialogContent = this.pcWarning + dialogContent;

					let dialogPromise = new Promise((resolve, reject) => {
						const dialog = new Dialog({
							title: "Confirm Mook Action",
							content: dialogContent,
							buttons: {
								approve: {
									label: game.i18n.localize("Approve"),
									callback: () => { resolve(); }
								},
								reject: {
									label: game.i18n.localize("Reject"),
									callback: () => { reject(); }
								}
							},
							default: "approve",
							close: reject
						});

						dialog.render(true);
						dialog.position.top = 120;
						dialog.position.left = 120;
					});

					try {
						await dialogPromise;
					}
					catch (error) {
						this.handleFailure(new Abort("User aborted plan"));
					}
				}

				if (action.cost > 0)
				{
					this.utility.clearHighlights ();
					const success = await this.utility.traverse (action.data.dist, this.rotationDelay, this.moveDelay);
					if (success) {
						const tilesMoved = action.cost;
						this.mookModel.recordMovement(tilesMoved);
					} else {
						this.handleFailure (new Error ("Failed to traverse path"));
					}
				}
				break;
			}

			this.time -= action.cost ? action.cost : 0;
		}

		let str = "mookAI | Unknown failure";

		if (tries <= 0)
			str = "mookAI | Planning failure: forced exit after too many loops.";
		if (this.time <= -1)
			str = "mookAI | Planning failure: mook took too many actions.";

		//TODO handle this better but for now we want full stack trace
		this.handleFailure (new Error (str));
		}
		catch (e) {
			console.log("mookAI | Encountered unrecoverable in act():");
			if (e instanceof Error) {
				console.error("Error message:", e.message);
				console.error("Error name:", e.name);
				console.error("Error stack trace:", e.stack);
			} else {
				console.error("Unknown error caught:", e);
			}
		}
	}

	inCombat () { return this.token.inCombat; }
	isPC (token_ = this.token) { return token_.actor.hasPlayerOwner; }

	handleTokenUpdate (changes_)
	{
		if (changes_._id !== this.token.id)
			return;

		this.segment.update (changes_);
	}

	async cleanup ()
	{
		// todo: Undo all actions
		this.utility.clearHighlights ();
		this.clearTargets ();
		await this.endTurn ();
	}

	// Mooks don't have the emotional intelligence to handle failure :(
	// todo: teach mooks how to love themselves
	handleFailure (error_)
	{
		throw error_;
	}

	canSee (id_)
	{
		// I have no idea how this works, but it seems to anyway
		return canvas.tokens.children[0].children.some (e =>
			{ return e.id === id_ && e.isVisible; });
	}

	async centerCamera ()
	{
		const p = this._pointFactory.centerFromToken (this.token);
		await canvas.animatePan ({ x: p.px, y: p.py });
	}

	// Expects degrees
	async rotate (dTheta_)
	{
		debugLog("Debug 24: starting rotate");
		if (dTheta_ === null || dTheta_ === undefined || dTheta_ === NaN)
		{
			console.error ("mookAI | Attempted invalid rotation");
			return;
		}

		// Add check for disabled rotation
		if (this.rotationDisabled) {
			debugLog("Debug: Rotation disabled, skipping rotation");
			return;
		}

		await this.tokenDoc.update ({ rotation: (this.rotation + dTheta_) % 360 });
		await new Promise (resolve => setTimeout (resolve, this.rotationDelay));
	}

	get viableTargets ()
	{
		debugLog("Debug 25: starting viableTargets");
		let meleTargets = [];
		let rangedTargets = [];

		if (this.mookModel.hasMele) {
			meleTargets = this.visibleTargets.filter (e => {
				const reachable = this.isTargetReachable (e, this.mookModel.meleRange);
				debugLog(`Debug: Melee target ${e.name} reachable: ${reachable}`);
				return reachable;
			});
			debugLog("Debug: Melee targets:", meleTargets.map(t => t.name));
		}

		if (this.mookModel.hasRanged) {
			rangedTargets = this.visibleTargets.filter (e => {
				const reachable = this.isTargetReachable (e, this.mookModel.rangedRange);
				debugLog(`Debug: Ranged target ${e.name} reachable: ${reachable}`);
				return reachable;
			});
			debugLog("Debug: Ranged targets:", rangedTargets.map(t => t.name));
		}

		if (meleTargets.length === 0 && rangedTargets.length === 0)
			return null;

		return { "mele": meleTargets, "ranged": rangedTargets };
	}

	/**
	 * @param {Token} target_
	**/
	degreesToTarget (target_)
	{
		const p1 = this._pointFactory.centerFromToken (this.token);
		const p2 = this._pointFactory.centerFromToken (target_);
		return p1.radialDistToPoint (p2, this.rotation, AngleTypes.DEG);
	}

	async move (segment_)
	{
		debugLog("Debug 26: starting move");
		if (! this.utility.isTraversable (this.segment, segment_))
			return false;

		let error = false;

		await this.rotate (this.segment.radialDistToSegment (segment_, this.tokenDoc.rotation, AngleTypes.DEG));
		await this.tokenDoc.update ({ x: segment_.point.px, y: segment_.point.py }).catch (err => {
			ui.notifications.warn (err);
			error = true;
		});

		if (error) return false;

		this._segment = segment_;

		await this.centerCamera ();
		await new Promise (resolve => setTimeout (resolve, this.moveDelay));

		return true;
	}

	async step ()
	{
		debugLog("Debug 27: starting step");
		const angles = this.neighborAngles.sort ((a, b) =>
		{
			return Math.min (a, 360 - a) - Math.min (b, 360 - b);
		});
		for (let angle of angles)
		{
			let success = await this.move (this.segment.neighbor (angle, this.rotation));
			if (success) return true;
		}

		return false;
	}

	async endTurn ()
	{
		if (this.rotationDisabled)
			await this.unlockRotation();

		this.releaseControl();
	}

	isTargetReachable (target_, attackRange_) {
		debugLog("Debug: Checking if target is reachable", {
			targetName: target_.name,
			attackRange: attackRange_
		});

		// Get the path to the target
		const path = this.pathManager.path(this.token.id, target_.id);
		debugLog("Debug: Path details", {
			pathValid: path.valid,
			pathCost: path.cost,
			terminalDistance: path.terminalDistanceToDest
		});

		// Calculate if target is within range
		const isWithinRange = path.terminalDistanceToDest <= attackRange_;
		debugLog("Debug: Range check", {
			terminalDistance: path.terminalDistanceToDest,
			attackRange: attackRange_,
			isWithinRange: isWithinRange
		});

		// If target is not reachable, log why
		if (!isWithinRange) {
			debugLog(`Debug: Target ${target_.name} is NOT reachable - too far away`, {
				distanceToTarget: path.terminalDistanceToDest,
				requiredRange: attackRange_,
				difference: path.terminalDistanceToDest - attackRange_
			});
		} else {
			debugLog(`Debug: Target ${target_.name} IS reachable`, {
				distanceToTarget: path.terminalDistanceToDest,
				weaponRange: attackRange_
			});
		}

		return isWithinRange;
	}

	get rotationDisabled() {
		return game.settings.get("mookAI-12", "DisableRotation");
	}

	async lockRotation() {
		debugLog("Debug: lockRotation called - current lock state:", this.tokenLocked);
		if (this.tokenLocked === true) {
			debugLog("Debug: Token already locked, skipping");
			return;
		}

		debugLog("Debug: Locking token rotation");
		await this.tokenDoc.update({ lockRotation: true });
		this._disabledRotation = true;
		debugLog("Debug: Token rotation locked");
	}

	async unlockRotation() {
		debugLog("Debug: unlockRotation called - current disabled state:", this._disabledRotation);
		if (!this._disabledRotation) {
			debugLog("Debug: Token not manually locked, skipping");
			return;
		}

		debugLog("Debug: Unlocking token rotation");
		await this.tokenDoc.update({ lockRotation: false });
		this._disabledRotation = false;
		debugLog("Debug: Token rotation unlocked");
	}

	releaseControl () { this.token.release ({}); }
	takeControl () { this.token.control ({}); }

	clearTargets ()
	{
		for (const t of this._targetedTokens)
			t.setTarget (false, { releaseOthers: true, groupSelection: false });

		this._targetedTokens = new Array ();
	}

	target (token_)
	{
		this._targetedTokens.push (token_);
		token_.setTarget (true, { releaseOthers: true, groupSelection: false });
	}

	get isExploreDisabled ()
	{
		const ret = game.settings.get ("mookAI-12", "DisableExploration");
		return (typeof ret === "boolean") ? ret : false;
	}

	get isExplorer ()
	{
		const ret = game.settings.get ("mookAI-12", "ExploreAutomatically");
		return (typeof ret === "boolean") ? ret : false;
	}

	get neighborAngles () { return Object.values (SquareNeighborAngles); }

	get mookModel () { return this._mookModel; } 

	get moveDelay ()
	{
		const ret = game.settings.get ("mookAI-12", "MoveAnimationDelay");
		if (ret < 0) return 0;
		if (ret > 1000) return 1000;
		return ret;
	}

	get pathManager () { return this._pathManager; } 
	get pathManagerConfig ()
	{
		this._pathManagerConfig.constrainVision = ! game.settings.get ("mookAI-12", "MookOmniscience");
		return this._pathManagerConfig;
	} 

	get plan () { return this._plan; }

	get point () { return this._segment.point; }

	get rotation () { return this.token.document.rotation; }

	get rotationDelay ()
	{
		const ret = game.settings.get ("mookAI-12", "RotationAnimationDelay");
		if (ret < 0) return 0;
		if (ret > 1000) return 1000;
		return ret;
	}

	get segment () { return this._segment; }

	get time () { return this._time; }
	set time (speed_) { this._time = speed_; }

	get token () { return this._token; }
	get tokenDoc () { return game.scenes.active.tokens.get(this._token.id) }

	get tokenLocked() { 
		return this.tokenDoc.lockRotation; 
	}

	get visibleTargets () { return this._visibleTargets; }
}
