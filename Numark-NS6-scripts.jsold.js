var NumarkNS6 = {};
NumarkNS6.Decks = [];
NumarkNS6.jogMSB = [0, 0, 0, 0, 0];
NumarkNS6.jogLSB = [0, 0, 0, 0, 0];
NumarkNS6.lastJogValue = [0, 0, 0, 0, 0];
NumarkNS6.blinkState = 0;
NumarkNS6.blinkTimer = 0;
NumarkNS6.scratchSettings = { "alpha": 1.0/4, "beta": 1.0/4/32, "jogResolution": 2500, "vinylSpeed": 33.33 };


// --- 2. MOTOR DE LEDs (O "Coração") ---
NumarkNS6.updatePlayCueLEDs = function(deckNum, midiChannel) {
    var group = "[Channel" + deckNum + "]";
    var statusCC = 0xB0 + midiChannel;
    
    var isPlaying = engine.getValue(group, "play");
    var isLoaded = engine.getValue(group, "track_loaded");
    
    // Lê DIRETAMENTE do Mixxx se o botão Cue está sendo pressionado fisicamente
    var isCueHeld = engine.getValue(group, "cue_default"); 
    
    var blink = NumarkNS6.blinkState;

    if (!isLoaded) {
        midi.sendShortMsg(statusCC, 0x09, 0x00);
        midi.sendShortMsg(statusCC, 0x08, 0x00);
        return;
    }

    // PRIORIDADE ABSOLUTA 1: Dedo no botão Cue (Modo Preview)
    if (isCueHeld > 0) {
        midi.sendShortMsg(statusCC, 0x09, 0x7F); // Play Aceso Fixo
        midi.sendShortMsg(statusCC, 0x08, 0x7F); // Cue Aceso Fixo
        return; // O return trava a função aqui!
    } 
    
    // PRIORIDADE 2: Música Tocando Sozinha (Mão fora do controle)
    if (isPlaying) {
        midi.sendShortMsg(statusCC, 0x09, 0x7F); // Play Aceso Fixo
        midi.sendShortMsg(statusCC, 0x08, 0x00); // Cue Apagado
        return;
    } 
        
    // PRIORIDADE 3: Música Pausada
    var cuePoint = engine.getValue(group, "cue_point");
    var trackSamples = engine.getValue(group, "track_samples");
    var playPos = engine.getValue(group, "playposition");
    
    var atCuePoint = false;
    
    // Lógica Matemática: Calcula se a agulha está em cima do CuePoint gravado
    if (trackSamples > 0 && cuePoint !== -1) {
        var currentSample = playPos * trackSamples;
        if (Math.abs(currentSample - cuePoint) < 5000) {
            atCuePoint = true; // Está no ponto exato
        }
    } else if (playPos <= 0.002) {
        // Se não tem CuePoint gravado, o início da música age como um
        atCuePoint = true; 
    }

    if (atCuePoint) {
        midi.sendShortMsg(statusCC, 0x09, 0x00); // Play OFF
        midi.sendShortMsg(statusCC, 0x08, 0x7F); // Cue Aceso Fixo
    } else {
        midi.sendShortMsg(statusCC, 0x09, blink); // Play Pisca
        midi.sendShortMsg(statusCC, 0x08, blink); // Cue Pisca
    }
};

NumarkNS6.updateSyncLED = function(deckNum, midiChannel) {
    var group = "[Channel" + deckNum + "]";
    var statusNote = 0x90 + midiChannel;
    var isSync = engine.getValue(group, "sync_enabled");
    midi.sendShortMsg(statusNote, 0x0F, isSync ? NumarkNS6.blinkState : 0x00);
};

NumarkNS6.startBlinkTimer = function() {
    if (NumarkNS6.blinkTimer !== 0) engine.stopTimer(NumarkNS6.blinkTimer);
    NumarkNS6.blinkTimer = engine.beginTimer(500, function() {
        NumarkNS6.blinkState = (NumarkNS6.blinkState === 0) ? 0x7F : 0;
        for (var i = 1; i <= 4; i++) {
            if (NumarkNS6.Decks[i]) { // Trava de segurança
                NumarkNS6.updatePlayCueLEDs(i, NumarkNS6.Decks[i].midiChannel);
                NumarkNS6.updateSyncLED(i, NumarkNS6.Decks[i].midiChannel);
            }
        }
    });
};

NumarkNS6.searchAmplification = 5; // multiplier for the jogwheel when the search button is held down.

NumarkNS6.warnAfterTime = 30; // Acts like the "End of Track warning" setting within the waveform settings.

NumarkNS6.blinkInterval=1000; //blinkInterval for the triangular Leds over the channels in milliseconds.

NumarkNS6.encoderResolution=0.05; // 1/encoderResolution = number of steps going from 0% to 100%

NumarkNS6.resetHotCuePageOnTrackLoad=true; // resets the page of the Hotcue back to 1 after loading a new track.

NumarkNS6.cueReverseRoll=true; // enables the ability to do a reverse roll while shift-pressing the cue button

// true = wrap around => scrolling past 4 will reset the page to the first page and vice versa
// false = clamp the the pages to the [1:4] range
NumarkNS6.hotcuePageIndexBehavior=true;

// possible ranges (0.0..3.0 where 0.06=6%)
NumarkNS6.rateRanges = [0,   // default (gets set via script later; don't modify)
    0.06, // one semitone
    0.24, // for maximum freedom
];

//
// CONSTANTS DO NOT CHANGE (if you don't know what you are doing)
//
NumarkNS6.QueryStatusMessage=[0xF0, 0x00, 0x01, 0x3F, 0x7F, 0x47, 0x60, 0x00, 0x01, 0x54, 0x01, 0x00, 0x00, 0x00, 0x00, 0xF7];
//NumarkNS6.ShutoffSequence=[0xF0,0x00,0x01,0x3F,0x7F,0x47,0xB0,0x39,0x00,0x01,0xF7]; // Invalid Midibyte?

NumarkNS6.vinylTouched = [false, false, false, false];

NumarkNS6.globalShift = false;

NumarkNS6.scratchXFader = {
    xFaderMode: 0, // fast cut (additive)
    xFaderCurve: 999.60,
    xFaderCalibration: 1.0
};

components.Encoder.prototype.input = function(_channel, _control, value, _status, _group) {
    this.inSetParameter(
        this.inGetParameter()+(
            (value===0x01)?
                NumarkNS6.encoderResolution:
                -NumarkNS6.encoderResolution
        )
    );
};

components.Component.prototype.send = function(value) {
    // This Override is supposed to make integration automatic assignment of elements easier.
    // Right now it just allows specifying the input and output bytes (even though the input bytes dont do anything right now.)
    if (this.midi === undefined || this.midi[0] === undefined || this.midi[1] === undefined) {
        return;
    }
    if (this.midi[2]===undefined) { //check if output channel/type not explicitly defined
        this.midi[2]=this.midi[0];
    }
    if (this.midi[3]===undefined) { //check if output control not explicitly defined
        this.midi[3]=this.midi[1];
    }
    midi.sendShortMsg(this.midi[2], this.midi[3], value);
    if (this.sendShifted) {
        if (this.shiftChannel) {
            midi.sendShortMsg(this.midi[2] + this.shiftOffset, this.midi[3], value);
        } else if (this.shiftControl) {
            midi.sendShortMsg(this.midi[2], this.midi[3] + this.shiftOffset, value);
        }
    }
};

// gets filled via trigger of the callbacks in NumarkNS6.crossfaderCallbackConnections
NumarkNS6.storedCrossfaderParams = {};
NumarkNS6.crossfaderCallbackConnections = [];
NumarkNS6.CrossfaderChangeCallback = function(value, group, control) {
    // indicates that the crossfader settings were changed while during session
    this.changed = true;
    NumarkNS6.storedCrossfaderParams[control] = value;
};

NumarkNS6.init = function() {
    NumarkNS6.rateRanges[0] = engine.getValue("[Channel1]", "rateRange");
    NumarkNS6.Decks = [];
    NumarkNS6.Mixer = new NumarkNS6.MixerTemplate();
    // Inicia o timer único e blindado
    NumarkNS6.startBlinkTimer();

    midi.sendSysexMsg(NumarkNS6.QueryStatusMessage, NumarkNS6.QueryStatusMessage.length);
    
    for (var i = 1; i <= 4; i++) {
        
        // Criamos o Deck (passando o índice 1-4)
        NumarkNS6.Decks[i] = new NumarkNS6.Deck(i);
        
        // Criamos um escopo fechado (IIFE) para cada conexão para evitar conflitos de variáveis
        (function(dIdx) {
            var g = "[Channel" + dIdx + "]";
            engine.makeConnection(g, "play", function() { if (NumarkNS6.Decks[dIdx]) NumarkNS6.updatePlayCueLEDs(dIdx, NumarkNS6.Decks[dIdx].midiChannel); });
            engine.makeConnection(g, "sync_enabled", function() { if (NumarkNS6.Decks[dIdx]) NumarkNS6.updateSyncLED(dIdx, NumarkNS6.Decks[dIdx].midiChannel); });
            engine.makeConnection(g, "track_loaded", function() { if (NumarkNS6.Decks[dIdx]) NumarkNS6.updatePlayCueLEDs(dIdx, NumarkNS6.Decks[dIdx].midiChannel); });
            
            // NOVA CONEXÃO: Aciona a função de LEDs no exato milissegundo que você pressiona o Cue
            // 🔥 A MÁGICA: Piscar com a batida
            engine.makeConnection(g, "beat_active", function(value) {
                var isSync = engine.getValue(g, "sync_enabled");
                var midiChan = NumarkNS6.Decks[dIdx].midiChannel;
                
                if (isSync) {
                    // Se o Sync estiver ON, o LED segue o pulso da batida (1 = aceso, 0 = apagado)
                    midi.sendShortMsg(0xB0 + midiChan, 0x07, value ? 0x7F : 0x00);
                } else {
                    // Se o Sync estiver OFF, LED apagado
                    midi.sendShortMsg(0xB0 + midiChan, 0x07, 0x00);
                }
            });       
         })(i);
    }

    NumarkNS6.Mixer = new NumarkNS6.MixerTemplate();
    
    // Inicia os Timers de LED (Certifique-se de que NumarkNS6.initLEDTimers() ou o blinkTimer já existam)
    // Se você seguiu o passo anterior, o timer global já estará rodando.

    midi.sendSysexMsg(NumarkNS6.QueryStatusMessage, NumarkNS6.QueryStatusMessage.length);
};
NumarkNS6.topContainer = function(channel) {
    this.group = "[Channel"+channel+"]";
    var theContainer = this;

    this.btnEffect1 = new components.Button({
        midi: [0x90+channel, 0x13, 0xB0+channel, 0x0B],
        shift: function() {
            this.group="[EffectRack1_EffectUnit1]";
            this.type=components.Button.prototype.types.toggle;
            this.inKey="group_[Channel"+channel+"]_enable";
            this.outKey="group_[Channel"+channel+"]_enable";
        },
        unshift: function() {
            this.group=theContainer.group;
            this.type=components.Button.prototype.types.push;
            this.inKey="loop_in";
            this.outKey="loop_in";
        },
    });
    this.btnEffect2 = new components.Button({
        midi: [0x90+channel, 0x14, 0xB0+channel, 0x0C],
        shift: function() {
            this.group="[EffectRack1_EffectUnit2]";
            this.type=components.Button.prototype.types.toggle;
            this.inKey="group_[Channel"+channel+"]_enable";
            this.outKey="group_[Channel"+channel+"]_enable";
        },
        unshift: function() {
            this.group=theContainer.group;
            this.type=components.Button.prototype.types.push;
            this.inKey="loop_out";
            this.outKey="loop_out";
        },
    });
    this.btnSample3 = new components.Button({
        midi: [0x90+channel, 0x15, 0xB0+channel, 0x0D],
        shift: function() {
            this.type=components.Button.prototype.types.toggle;
            this.inKey="slip_enabled";
            this.outKey="slip_enabled";
        },
        unshift: function() {
            this.type=components.Button.prototype.types.push;
            this.inKey="beatloop_activate";
            this.outKey="beatloop_activate";
        },
    });
    this.btnSample4 = new components.Button({
        midi: [0x90+channel, 0x16, 0xB0+channel, 0x0E],
        outKey: "loop_enabled",
        shift: function() {
            this.type=components.Button.prototype.types.toggle;
            this.inKey="reloop_andstop";
        },
        unshift: function() {
            this.type=components.Button.prototype.types.push;
            this.inKey="reloop_toggle";
        },
    });
    // custom Hotcue Buttons
    this.hotcueButtons=[];

    for (var counter=0; counter<=3; counter++) {
        this.hotcueButtons[counter] = new components.HotcueButton({
            midi: [0x90+channel, 0x27+counter, 0xB0+channel, 0x18+counter],
            number: counter+1,
        });
    }
    this.encFxParam1 = new components.Encoder({
        midi: [0xB0+channel, 0x57],
        group: "[EffectRack1_EffectUnit1]",
        shift: function() {
            this.inKey="mix";
        },
        unshift: function() {
            this.inKey="super1";
        },
    });
    this.encFxParam2 = new components.Encoder({
        midi: [0xB0+channel, 0x58],
        group: "[EffectRack1_EffectUnit2]",
        shift: function() {
            this.inKey="mix";
        },
        unshift: function() {
            this.inKey="super1";
        },
    });
    this.encSample3 = new components.Encoder({
        midi: [0xB0+channel, 0x5A],
        hotCuePage: 0,
        applyHotcuePage: function(layer, displayFeedback) {
            // ES3 doesn't allow default values in the function signature
            // Could be replaced after migration to QJSEngine by "displayFeedback=true"
            // in the function arguments.
            if (displayFeedback === undefined) {
                displayFeedback = true;
            }
            // when the layer becomes negative, the (layer+4) will force a positive/valid page indexOf
            layer = NumarkNS6.hotcuePageIndexBehavior ? (layer+4)%4 : Math.max(Math.min(layer, 3), 0); // clamp layer value to [0;3] range
            this.hotCuePage = layer;
            if (this.timer !== 0) {
                engine.stopTimer(this.timer);
                this.timer = 0;
            }
            var number = 0;
            for (var i=0; i<theContainer.hotcueButtons.length; ++i) {
                number = (i+1)+theContainer.hotcueButtons.length*this.hotCuePage;
                theContainer.hotcueButtons[i].disconnect();
                theContainer.hotcueButtons[i].number=number;
                theContainer.hotcueButtons[i].outKey="hotcue_" + number + "_enabled";
                theContainer.hotcueButtons[i].unshift(); // for setting inKey based on number property.
                theContainer.hotcueButtons[i].connect();
                theContainer.hotcueButtons[i].trigger();
            }
            //  displays the current hotcuepage index within the upper row of the buttongrid
            if (displayFeedback) {
                for (i=0; i<4; ++i) {
                    midi.sendShortMsg(0xB0+channel, 0x0B+i, (i-this.hotCuePage)?0x00:0x7F);
                }
            }
            this.timer = engine.beginTimer(1000, () => {
                theContainer.reconnectComponents();
                this.timer = 0;
            }, true);
        },
        shift: function() {
            this.group=theContainer.group;
            this.input = function(_channel, _control, value, _status, _group) {
                if (value === 0x01) {
                    engine.setParameter(this.group, "loop_double", 1);
                } else {
                    engine.setParameter(this.group, "loop_halve", 1);
                }
            };
        },
        unshift: function() {
            this.input = function(_channel, _control, value, _status, _group) {
                this.applyHotcuePage(this.hotCuePage+(value===0x01?1:-1));
            };
        },
    });
    this.encSample4 = new components.Encoder({
        midi: [0xB0+channel, 0x59],
        shift: function() {
            this.inKey="beatjump_size";
            this.input = function(_channel, _control, value, _status, _group) {
                this.inSetValue(this.inGetValue() * (value===0x01 ? 2 : 0.5));
            };
        },
        unshift: function() {
            this.input = function(_channel, _control, value, _status, _group) {
                script.triggerControl(this.group, (value===1)?"beatjump_forward":"beatjump_backward");
            };
        },
    });
    this.shutdown = function() {
    // turn off hotcueButtons
        for (var i=0; i<theContainer.hotcueButtons.length; i++) {
            theContainer.hotcueButtons[i].send(0);
        }
        // turn all remaining LEDS of the topContainer
        theContainer.btnEffect1.send(0);
        theContainer.btnEffect2.send(0);
        theContainer.btnSample3.send(0);
        theContainer.btnSample4.send(0);
    };

    if (NumarkNS6.resetHotCuePageOnTrackLoad) {
        engine.makeConnection(this.group, "track_loaded", function(_value, _group, _control) {
            theContainer.encSample3.applyHotcuePage(0, false);
            // resets the hotcuepage to 0 hidden (without feedback to the user);
        });
    }
};
NumarkNS6.topContainer.prototype = new components.ComponentContainer();

NumarkNS6.MixerTemplate = function() {
    //channel will always be 0 it can be "hardcoded" into the components
    this.deckChangeL = new components.Button({
        midi: [0xB0, 0x50],
        input: function(_channel, _control, value, _status, _group) {
            this.output(value);
            //just "echos" the midi since the controller knows the deck its on itself but doesn't update the corresponding leds.
        },
    });
    this.deckChangeR = new components.Button({
        midi: [0xB0, 0x51],
        input: function(_channel, _control, value, _status, _group) {
            this.output(value);
        },
    });

    this.channelInputSwitcherL = new components.Button({
        midi: [0x90, 0x49],
        group: "[Channel3]",
        inKey: "mute",
    });
    this.channelInputSwitcherR = new components.Button({
        midi: [0x90, 0x4A],
        group: "[Channel4]",
        inKey: "mute",
    });

    this.changeCrossfaderContour = new components.Button({
        midi: [0x90, 0x4B],
        state: false,
        input: function(channel, control, value, status, _group) {
            _.forEach(NumarkNS6.crossfaderCallbackConnections, function(callbackObject) {
                callbackObject.disconnect();
            });
            NumarkNS6.crossfaderCallbackConnections = [];
            this.state=this.isPress(channel, control, value, status);
            if (this.state) {
                _.forEach(NumarkNS6.scratchXFader, function(value, control) {
                    engine.setValue("[Mixer Profile]", control, value);
                    NumarkNS6.crossfaderCallbackConnections.push(
                        engine.makeConnection("[Mixer Profile]", control, NumarkNS6.CrossfaderChangeCallback.bind(this))
                    );
                });
            } else {
                _.forEach(NumarkNS6.storedCrossfaderParams, function(value, control) {
                    engine.setValue("[Mixer Profile]", control, value);
                    NumarkNS6.crossfaderCallbackConnections.push(
                        engine.makeConnection("[Mixer Profile]", control, NumarkNS6.CrossfaderChangeCallback.bind(this))
                    );
                });
            }
        }
    });

    this.navigationEncoderTick = new components.Encoder({
        midi: [0xB0, 0x44],
        group: "[Library]",
        stepsize: 1,
        shift: function() {
            this.inKey="MoveFocus";
        },
        unshift: function() {
            this.inKey="MoveVertical";
        },
        input: function(_midiChannel, _control, value, _status, _group) {
            this.inSetValue(value===0x01?this.stepsize:-this.stepsize); // value "rescaling"; possibly inefficient.
        },
    });
    this.navigationEncoderButton = new components.Button({
        shift: function() {
            this.type=components.Button.prototype.types.toggle;
            this.group="[Skin]";
            this.inKey="show_maximized_library";
        },
        unshift: function() {
            this.type=components.Button.prototype.types.push;
            this.group="[Library]";
            this.inKey="GoToItem";
        },
    });
};

NumarkNS6.MixerTemplate.prototype = new components.ComponentContainer();

NumarkNS6.Deck = function(channel) {
    var groupName = "[Channel" + channel + "]"; 
    this.deckNum = channel;
    this.midiChannel = channel;
    this.group = groupName;
    this.rateRangeEntry = 0;
    this.rangeIndex = 0; 
    this.rateRangeEntry = 0;
    var theDeck = this;

    // 2. Inicialização do Componente Mixxx
    components.Deck.call(this, channel);
    this.topContainer = new NumarkNS6.topContainer(channel);
  

    // 3. Containers e Flags
    this.scratchMode = true; 
    this.isSearching = false;

       // --- PITCH BEND (Adicionado aqui no lugar certo!) ---
    this.pitchBendMinus = new components.Button({
        midi: [0x90 + channel, 0x18, 0xB0 + channel, 0x3D],
        group: groupName,
        key: "rate_temp_down",
        shift: function() { this.inKey = "rate_temp_down_small"; },
        unshift: function() { this.inKey = "rate_temp_down"; }
    });

    this.pitchBendPlus = new components.Button({
        midi: [0x90 + channel, 0x19, 0xB0 + channel, 0x3C],
        group: groupName,
        key: "rate_temp_up",
        shift: function() { this.inKey = "rate_temp_up_small"; },
        unshift: function() { this.inKey = "rate_temp_up"; }
    });

    // --- FIREWALL LÓGICO: Injetamos o grupo em cada componente ---

   // --- PLAY, CUE E SYNC ---
    this.playButton = new components.PlayButton({
        midi: [0x90 + channel, 0x11, 0xB0 + channel, 0x09],
        group: groupName,
        outKey: null,
        input: function(ch, ct, val, status) {
            components.PlayButton.prototype.input.apply(this, arguments);
            NumarkNS6.updatePlayCueLEDs(theDeck.deckNum, theDeck.midiChannel);
        }
    });

    this.cueButton = new components.CueButton({
        midi: [0x90 + channel, 0x10, 0xB0 + channel, 0x08],
        group: groupName,
        outKey: null,
        reverseRollOnShift: NumarkNS6.cueReverseRoll
    });

    // --- BOTÃO SYNC (Com atualização de LED manual) ---
    this.syncButton = new components.SyncButton({
        midi: [0x90 + channel, 0x0F], // Apenas entrada
        group: groupName,
        outKey: null // Deixa a conexão beat_active lá do init mandar no LED
    });

    this.loadButton = new components.Button({
        midi: [0x90 + channel, 0x06],
        group: groupName,
        shift: function() { this.inKey = "eject"; },
        unshift: function() { this.inKey = "LoadSelectedTrack"; }
    });

    // ... (Aqui você mantém seus Knobs de EQ e Gain que já funcionam) ...

    this.bpmSlider = new components.Pot({
        midi: [0xB0 + channel, 0x01, 0xB0 + channel, 0x37],
        inKey: "rate",
        group: groupName,
        invert: true,
    });

    // --- RECONECTAR COM SEGURANÇA ---
    this.reconnectComponents(function(c) {
        // Se o componente não tiver grupo, ele herda o groupName deste objeto
        if (c.group === undefined || c.group === "") {
            c.group = groupName;
        }
    });

    this.shutdown = function() {
        this.topContainer.shutdown();
        this.cueButton.send(0);
        this.playButton.send(0);
    };
};

NumarkNS6.Deck.prototype = new components.Deck();

NumarkNS6.shutdown = function() {
    for (var i=1; i<=4; i++) {
    // View Definition of Array for explanation.
        NumarkNS6.Decks[i].shutdown();
    }
    // revert the crossfader parameters only if they haven't been changed by the
    // user and if they are currently set to scratch
    if (!NumarkNS6.CrossfaderChangeCallback.changed || NumarkNS6.changeCrossfaderContour.state) {
        _.forEach(NumarkNS6.storedCrossfaderParams, function(value, control) {
            engine.setValue("[Mixer Profile]", control, value);
        });
    }
    // midi.sendSysexMsg(NumarkNS6.ShutoffSequence,NumarkNS6.ShutoffSequence.length);
};
// --- FUNÇÃO DE TOQUE GLOBAL (TOUCH) ---
// --- FUNÇÃO DE TOQUE GLOBAL (TOUCH) ATUALIZADA ---
NumarkNS6.jogTouch14bit = function(channel, control, value, status, group) {
    var deckNum = script.deckFromGroup(group);
    var theDeck = NumarkNS6.Decks[deckNum];

    var isScratchButtonOn = (theDeck.jogWheelScratchEnable.scratchEnabled !== false);
    var isTouched = (status & 0x10) || (value > 0);

    if (isTouched && isScratchButtonOn) {
        // Usando as variáveis do scratchSettings definidas no topo
        engine.scratchEnable(deckNum, 
            NumarkNS6.scratchSettings.jogResolution, 
            NumarkNS6.scratchSettings.vinylSpeed, 
            NumarkNS6.scratchSettings.alpha, 
            NumarkNS6.scratchSettings.beta);
    } else {
        engine.scratchDisable(deckNum);
    }
};

// --- FUNÇÃO DE GIRO GLOBAL (MOVE) ---
NumarkNS6.jogMove14bit = function(channel, control, value, status, group) {
    var deckNum = script.deckFromGroup(group);

    // Armazenamento 14-bit
    if (control === 0x00) NumarkNS6.jogMSB[deckNum] = value;
    if (control === 0x20) NumarkNS6.jogLSB[deckNum] = value;

    // Sincroniza no byte LSB (0x20)
    if (control !== 0x20) return;

    var fullValue = (NumarkNS6.jogMSB[deckNum] << 7) | NumarkNS6.jogLSB[deckNum];
    
    if (NumarkNS6.lastJogValue[deckNum] === undefined) NumarkNS6.lastJogValue[deckNum] = fullValue;
    var delta = fullValue - NumarkNS6.lastJogValue[deckNum];
    NumarkNS6.lastJogValue[deckNum] = fullValue;

    if (delta > 8192) delta -= 16384;
    if (delta < -8192) delta += 16384;
    if (delta === 0) return;

    // AQUI É ONDE O SCRATCH ACONTECE:
    if (engine.isScratching(deckNum)) {
        engine.scratchTick(deckNum, delta);
    } else {
        // Modo CDJ (Bend Suave)
        var sensitivity = 15; 
        engine.setValue(group, "jog", delta / sensitivity);
    }
};

NumarkNS6.updatePlayCueLEDs = function(deckNum, midiChannel) {
    var group = "[Channel" + deckNum + "]";
    var statusLED = 0xB0 + midiChannel; 
    
    var isPlaying = engine.getValue(group, "play");
    var isLoaded = engine.getValue(group, "track_loaded");
    // Consideramos no início se a posição for zero ou o arquivo acabou de carregar (-1)
    var playPos = engine.getValue(group, "playposition");
    var atStart = (playPos <= 0.001 || playPos === -1); 
    
    var playLED = 0x09;
    var cueLED = 0x08;
    var ON = 0x7F;
    var OFF = 0x00;
    var BLINK = NumarkNS6.blinkState ? ON : OFF;

    if (!isLoaded) {
        midi.sendShortMsg(statusLED, playLED, OFF);
        midi.sendShortMsg(statusLED, cueLED, OFF);
    } else if (isPlaying) {
        // TOCANDO: Ambos ACESOS
        midi.sendShortMsg(statusLED, playLED, ON);
        midi.sendShortMsg(statusLED, cueLED, ON);
    } else if (atStart) {
        // PARADO NO CUE/INÍCIO: Cue ACESO, Play PISCA
        midi.sendShortMsg(statusLED, playLED, BLINK);
        midi.sendShortMsg(statusLED, cueLED, ON);
    } else {
        // PAUSADO NO MEIO: Ambos PISCANDO
        midi.sendShortMsg(statusLED, playLED, BLINK);
        midi.sendShortMsg(statusLED, cueLED, BLINK);
    }
};

NumarkNS6.updateSyncLED = function(deckNum, midiChannel) {
    var group = "[Channel" + deckNum + "]";
    var statusLED = 0x90 + midiChannel; // 0x91 para Deck 1, 0x92 para Deck 2...
    var syncNote = 0x0F; 
    
    var syncEnabled = engine.getValue(group, "sync_enabled");
    var BLINK = NumarkNS6.blinkState ? 0x7F : 0x00;

    // Se o Sync estiver ligado, ele entra no ciclo de piscagem
    midi.sendShortMsg(statusLED, syncNote, syncEnabled ? BLINK : 0x00);
};