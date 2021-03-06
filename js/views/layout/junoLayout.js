define([
    'backbone',
    'application',
    'util',
    'views/layout/moduleLayout',
    'views/item/keyboardItemView',
    'views/item/readmeItemView',
    'synth/voice',
    'synth/lfo',
    'tuna',
    'models/junoModel',
    'hbs!tmpl/layout/junoLayout-tmpl'
    ],
    
    function(Backbone, App, util, ModuleLayout, KeyboardItemView, ReadmeItemView, Voice, LFO, Tuna, JunoModel, Template) {
        
        return Backbone.Marionette.LayoutView.extend({
            
            className: 'juno-container',
            
            template: Template,
            
            regions: {
                synthRegion: '.js-synth-region',
                keyboardRegion: '.js-keyboard-region',
                readmeRegion: '.js-readme-region'
            },
            
            initialize: function() {
                this.maxPolyphony = 6;
                this.activeVoices = [];
                
                // Initialize long-lived components
                var tuna = new Tuna(App.context);
                this.synth = new JunoModel();
                this.cho = new tuna.Chorus();
                this.cho.chorusLevel = this.synth.get('cho-chorusToggle');
                this.drive = new tuna.Overdrive({
                    outputGain: 0,
                    drive: 0.1,
                    curveAmount: 0.2,
                    algorithmIndex: 3,
                    bypass: 0 
                });
                this.masterGain = App.context.createGain();
                this.masterGain.gain.value = 0.5;
                this.masterGain.connect(App.context.destination);
                this.lfo = new LFO({
                    lfoRate: this.synth.get('lfo-rate'),
                    lfoPitch: this.synth.get('lfo-pitch'),
                    lfoDelay: this.synth.get('lfo-delay'),
                    lfoFreq: this.synth.get('lfo-freq'),
                    lfoPwmEnabled: this.synth.get('dco-lfoPwmEnabled'),
                    lfoPwm: this.synth.get('dco-pwm')
                });
                this.midiListener = new Backbone.Marionette.Object();
                
                this.cachedSynth = JSON.stringify(this.synth.attributes);
            },
            
            onShow: function() {
                var readme = new ReadmeItemView();
                
                this.moduleLayout = new ModuleLayout({
                    synth: this.synth,
                    midiListener: this.midiListener
                });
                this.synthRegion.show(this.moduleLayout);
                
                this.keyboardView = new KeyboardItemView();
                this.keyboardRegion.show(this.keyboardView);
                
                this.readmeRegion.show(readme);
                
                this.listenTo(this.keyboardView, 'noteOn', this.noteOnHandler);
                this.listenTo(this.keyboardView, 'noteOff', this.noteOffHandler);
                this.listenTo(this.midiListener, 'midiMessage', this.handleMidi);
                this.listenTo(this.synth, 'change', this.synthUpdateHandler);
                this.listenTo(readme, 'reset', this.handleReset);
            },
            
            noteOnHandler: function(note, frequency) {
                var that = this;
                var currentNote;
                
                for(var i = 0; i < this.activeVoices.length; i++) {
                    if(this.activeVoices[i].note === note) {
                        currentNote = this.activeVoices[i];
                    }
                }
            
                var voice = new Voice({
                    synthOptions: this.synth.getOptions(frequency),
                    lfo: this.lfo,
                    cho: this.cho
                });
                
                if(currentNote) {
                    currentNote.stealNote();
                    this.stopListening(currentNote);
                    this.activeVoices = _.without(this.activeVoices, currentNote);
                    console.log(currentNote.note + ' stolen');
                }
                
                if(this.activeVoices.length === this.maxPolyphony) {
                    this.stopListening(this.activeVoices[0]);
                    this.activeVoices[0].stealNote();
                    this.activeVoices.shift();
                    console.log(this.activeVoices[0].note + ' stolen');
                }
                
                voice.cho.connect(this.drive.input);
                this.drive.connect(this.masterGain);
                
                voice.noteOn();
                voice.note = note;
                this.activeVoices.push(voice);
            },
            
            noteOffHandler: function(note) {
                var currentNote;
                
                for(var i = 0; i < this.activeVoices.length; i++) {
                    if(this.activeVoices[i].note === note) {
                        currentNote = this.activeVoices[i];
                    }
                }
                            
                if(currentNote) {
                    this.listenToOnce(currentNote, 'killVoice', function() {
                        this.activeVoices = _.without(this.activeVoices, currentNote);
                    });
                    currentNote.noteOff();
                }

            },
            
            handleMidi: function(message) {
                var note;
                var frequency;
                
                if(message.type === 'noteOn') {
                    frequency = util.frequencyFromMidiNote(message.note);
                    note = util.noteFromMidiNumber(message.note);
                    this.noteOnHandler(note, frequency);
                } else if(message.type === 'noteOff') {
                    note = util.noteFromMidiNumber(message.note);
                    this.noteOffHandler(note);
                }
            },
            
            synthUpdateHandler: function(update) {                    
                var param = Object.keys(update.changed)[0];
                var value = update.changed[param];
                var component = param.slice(0, 3);
                var attr = param.slice(4);
                
                _.each(this.activeVoices, function(voice) {
                    voice[component][attr] = value;
                });
            },
            
            handleReset: function() {
                this.synth.set(JSON.parse(this.cachedSynth));
                this.moduleLayout.updateUIState();
            }
            
        });
    });