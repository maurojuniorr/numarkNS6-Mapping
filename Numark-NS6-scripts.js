var NumarkNS6 = {};
// Buffers para processamento de 14 bits (Adicione isso no topo)
NumarkNS6.jogMSB = [0, 0, 0, 0, 0];
NumarkNS6.jogLSB = [0, 0, 0, 0, 0];
NumarkNS6.lastJogValue = [0, 0, 0, 0, 0];

NumarkNS6.scratchSettings = {
    "alpha": 1.0 / 4,         // Aumentado de 1/8 para 1/4 (mais responsivo)
    "beta": 1.0 / 4 / 32,    // Ajustado proporcionalmente ao alpha
    "jogResolution": 2500,   // BAIXAMOS aqui. Quanto MENOR este número, MAIS a faixa anda.
    "vinylSpeed": 33 + 1 / 3,
}
NumarkNS6.blinkState = 0;
NumarkNS6.blinkTimer = engine.beginTimer(500, function() {
    NumarkNS6.blinkState = !NumarkNS6.blinkState;
    // Percorre os decks carregados
    for (var i = 1; i <= 4; i++) {
        if (NumarkNS6.Decks[i]) {
            // O Deck conhece seu próprio canal MIDI
            NumarkNS6.updatePlayCueLEDs(i, NumarkNS6.Decks[i].midiChannel);
        }
    }
});

NumarkNS6.blinkState = 0;

// Função para iniciar o motor de piscagem de forma segura
NumarkNS6.startBlinkTimer = function() {
    // Se já existe um timer, para ele primeiro (evita duplicidade)
    if (NumarkNS6.blinkTimer !== undefined) {
        engine.stopTimer(NumarkNS6.blinkTimer);
    }
    
    NumarkNS6.blinkTimer = engine.beginTimer(500, function() {
        NumarkNS6.blinkState = !NumarkNS6.blinkState;
        
        // O Timer é o ÚNICO responsável por enviar o sinal de piscagem
        for (var i = 1; i <= 4; i++) {
            if (NumarkNS6.Decks[i]) {
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
        (function(deckIdx) {
            var group = "[Channel" + deckIdx + "]";
            
            // 1. Conexão de Play
            engine.makeConnection(group, "play", function() {
                if (NumarkNS6.Decks[deckIdx]) {
                    NumarkNS6.updatePlayCueLEDs(deckIdx, NumarkNS6.Decks[deckIdx].midiChannel);
                }
            });

            // 2. Conexão de Carga de Música
            engine.makeConnection(group, "track_loaded", function() {
                if (NumarkNS6.Decks[deckIdx]) {
                    NumarkNS6.updatePlayCueLEDs(deckIdx, NumarkNS6.Decks[deckIdx].midiChannel);
                }
            });

            // 3. Conexão de Posição (Essencial para o retorno ao Cue)
            engine.makeConnection(group, "playposition", function() {
                if (engine.getValue(group, "play") === 0 && NumarkNS6.Decks[deckIdx]) {
                    NumarkNS6.updatePlayCueLEDs(deckIdx, NumarkNS6.Decks[deckIdx].midiChannel);
                }
            });

            // Dentro da IIFE no loop do init:
            engine.makeConnection(group, "sync_enabled", function() {
                if (NumarkNS6.Decks[deckIdx]) {
                    NumarkNS6.updateSyncLED(deckIdx, NumarkNS6.Decks[deckIdx].midiChannel);
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
    // 1. Identidade Única Imutável
    var groupName = "[Channel" + channel + "]"; 
    this.deckNum = channel;
    this.midiChannel = channel;
    this.group = groupName;
    
    var theDeck = this;

    // 2. Inicialização do Componente Mixxx
    components.Deck.call(this, channel);
    
    // Forçamos o Mixxx a reconhecer este objeto como o dono deste grupo agora
    this.currentDeck = groupName; 

    // 3. Containers e Flags
    this.isSearching = false;
    this.rateRangeEntry = 1;
    this.topContainer = new NumarkNS6.topContainer(channel);
    
    // --- FIREWALL LÓGICO: Injetamos o grupo em cada componente ---

    this.playButton = new components.PlayButton({
        midi: [0x90 + channel, 0x11, 0xB0 + channel, 0x09],
        group: groupName, // <--- IDENTIDADE FORÇADA
        outKey: null, 
        input: function(ch, ct, val, status) {
            components.PlayButton.prototype.input.apply(this, arguments);
            // Sem delay, chama direto. O Timer global vai sincronizar na próxima iteração.
            NumarkNS6.updatePlayCueLEDs(theDeck.deckNum, theDeck.midiChannel);
        }
    });

    this.cueButton = new components.CueButton({
        midi: [0x90 + channel, 0x10, 0xB0 + channel, 0x08],
        group: groupName, // <--- IDENTIDADE FORÇADA
        outKey: null,
        reverseRollOnShift: NumarkNS6.cueReverseRoll,
        input: function(ch, ct, val, status) {
            components.PlayButton.prototype.input.apply(this, arguments);
            // Sem delay, chama direto. O Timer global vai sincronizar na próxima iteração.
            NumarkNS6.updatePlayCueLEDs(theDeck.deckNum, theDeck.midiChannel);
        }
    });

    // --- BOTÃO SYNC (Piscante) ---
    this.syncButton = new components.SyncButton({
        midi: [0x90 + channel, 0x0F, 0xB0 + channel, 0x07],
        group: groupName,
        outKey: null, // Desativa o LED estático padrão
        input: function(ch, ct, val, status) {
            components.PlayButton.prototype.input.apply(this, arguments);
            // Sem delay, chama direto. O Timer global vai sincronizar na próxima iteração.
            NumarkNS6.updatePlayCueLEDs(theDeck.deckNum, theDeck.midiChannel);
        }
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