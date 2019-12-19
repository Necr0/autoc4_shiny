// Copyright (c) 2014-2016 Chaos Computer Club Cologne
//
// This file is MIT licensed. Please see the
// LICENSE file in the source package for more information.
//

var autoc4;
var __AUTOC4_CONFIG_LOCATION:string = __AUTOC4_CONFIG_LOCATION || "config.json";

$(function () {
    $.getJSON(__AUTOC4_CONFIG_LOCATION)
        .done(function (config) {
            if (config.debug && config.debug.configLoaded)
                console.log("Config loaded successfully", config);
            autoc4 = new AutoC4(
                config
            );
            update_time();
        })
        .fail(function (e, f) {
            console.error("Couldn't load config.json", e, f);
        });
});

var mqtt_client;

interface AutoC4Module {
    init(autoc4: AutoC4, options: any): this;
    onMessage(autoc4: AutoC4, message: Paho.MQTT.Message): void;
    onConnect(autoc4: AutoC4, o: Paho.MQTT.WithInvocationContext): void;
    onConnectionFailure(autoc4: AutoC4, error: Paho.MQTT.MQTTError): void;
}

interface AutoC4ModuleFactory {
    (): AutoC4Module;
}

interface AutoC4ModuleConfig {
    module: string;
    options: any;
    subscribe: string[];
}

interface AutoC4DebugConfig {
    message: boolean;
    connect: boolean;
    disconnect: boolean;
    configLoaded: boolean;
}

interface AutoC4InteractivityConfig{
    mqttTopicDataAttibute: string;
    mqttRetainedDataAttribute: string;
    mqttMessageDataAttribute: string;
    mqttByteMessageDataAttribute: string;
}

interface AutoC4Config {
    server?: string;
    port?: number;
    interactivity: AutoC4InteractivityConfig;
    modules: AutoC4ModuleConfig[];
    debug?: AutoC4DebugConfig;
}

class AutoC4 {
    private config: AutoC4Config;
    private readonly modules: AutoC4Module[] = [];
    public readonly client: Paho.MQTT.Client;

    public constructor(config: AutoC4Config) {
        this.config = config;

        this.client = new Paho.MQTT.Client(
            config.server || window.location.hostname,
            config.port || 9000,
            AutoC4.generateClientId()
        );
        this.client.onMessageArrived = this.onMessage.bind(this);
        this.client.onConnectionLost = this.onConnectionFailure.bind(this);

        for (var moduleConfig of config.modules) {
            try {
                this.modules.push(AutoC4.moduleConfigToModule(moduleConfig).init(this, moduleConfig.options));
            } catch (err) {
                console.error("An error occured while initializing a module.");
                console.error("Module: ", moduleConfig.module);
                console.error(err);
            }
        }

        const self: this = this;
        const interactivity = self.config.interactivity;

        $('#help').click(function (ev) {
            ev.preventDefault();
            $('#help-display').toggle();
        });

        $('body').on("click change input", `[${this.config.interactivity.mqttTopicDataAttibute}]`, function (this:HTMLElement) {
            if(this.hasAttribute(interactivity.mqttMessageDataAttribute)){
                self.sendData(
                    this.getAttribute(interactivity.mqttTopicDataAttibute),
                    this.getAttribute(interactivity.mqttMessageDataAttribute) as string,
                    Boolean(this.getAttribute(interactivity.mqttRetainedDataAttribute))
                );
            }else if(this.hasAttribute(interactivity.mqttByteMessageDataAttribute)){
                self.sendByte(
                    this.getAttribute(interactivity.mqttTopicDataAttibute),
                    Number(this.getAttribute(interactivity.mqttByteMessageDataAttribute)),
                    Boolean(this.getAttribute(interactivity.mqttRetainedDataAttribute))
                );
            }else{
                self.sendByte(
                    this.getAttribute(interactivity.mqttTopicDataAttibute),
                    0,
                    Boolean(this.getAttribute(interactivity.mqttRetainedDataAttribute))
                );
            }
        });

        this.connect();
    }

    public connect():void{
        this.client.connect({ onSuccess: this.onConnect.bind(this), onFailure: this.client.onConnectionLost, mqttVersion: 3 });
    }

    public onMessage(message: Paho.MQTT.Message) {
        if (this.config.debug.message)
            console.info("MQTT message received:", message);
        for (let module of this.modules) {
            try {
                module.onMessage(this, message);
            } catch (err) {
                console.error("An error occured while processing a message.");
                console.error("Module: ", module);
                console.error(err);
            }
        }
    }

    public onConnect(o: Paho.MQTT.WithInvocationContext): void {
        if (this.config.debug && this.config.debug.connect)
            console.info('MQTT connection successfull.', o);
        // Once a connection has been made, make subscriptions.
        for (let moduleConfig of this.config.modules) {
            if(!moduleConfig.subscribe)
                continue;
            for (let topic of moduleConfig.subscribe) {
                this.client.subscribe(topic);
            }
        }

        for (let module of this.modules) {
            try {
                module.onConnect(this, o);
            } catch (err) {
                console.error("An error occured while handling disconnect.");
                console.error("Module: ", module);
                console.error(err);
            }
        }
    }

    public onConnectionFailure(e: Paho.MQTT.MQTTError): void {
        if (this.config.debug && this.config.debug.disconnect)
            console.warn('MQTT connection failure, retrying in 5 seconds..', e);
        setTimeout(function (self: AutoC4) { self.connect() }, 5000, this);

        for (let module of this.modules) {
            try {
                module.onConnectionFailure(this, e);
            } catch (err) {
                console.error("An error occured while handling disconnect.");
                console.error("Module: ", module);
                console.error(err);
            }
        }
    }

    public sendData(topic: string, data: string|Uint8Array, retained:boolean = false): void {
        var message = new Paho.MQTT.Message(data);
        message.destinationName = topic;
        message.retained = retained;
        this.client.send(message);
    }
    public sendByte(topic: string, data: number, retained:boolean = false): void {
        var buf = new Uint8Array(data===undefined ? [0] : [data]);
        var message = new Paho.MQTT.Message(buf);
        message.destinationName = topic;
        message.retained = retained;
        this.client.send(message);
    }

    public static generateClientId(): string {
        return 'c4sw_yxxxxxxxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0;
            var v = (c == 'x') ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    private static _modules: {[name: string]:AutoC4ModuleFactory} = {};
    public static registerModule(name: string, factory: AutoC4ModuleFactory): void {
        this._modules[name]=factory;
    }
    public static moduleConfigToModule(config: AutoC4ModuleConfig): AutoC4Module {
        return this._modules[config.module]();
    }
}

function two_digits(i:number):string {
    return ("0" + i).slice(-2);
}

var update_time = function ():void {
    var now = new Date();
    var text = two_digits(now.getDate()) + "." + two_digits(now.getMonth() + 1) + "." + now.getFullYear() + " " + two_digits(now.getHours()) + ":" + two_digits(now.getMinutes());
    $('#datetime').text(text);
    setTimeout(update_time, 60000 - now.getSeconds() * 1000 - now.getMilliseconds());
};