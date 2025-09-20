import React from 'react';
import { withStyles } from '@material-ui/core/styles';

import GenericApp from '@iobroker/adapter-react/GenericApp';
import I18n from '@iobroker/adapter-react/i18n';
import Settings from './components/settings';

/**
 * @type {(_theme: import("@material-ui/core/styles").Theme) => import("@material-ui/styles").StyleRules}
 */
const styles = (_theme) => ({
    root: {},
});

class App extends GenericApp {
    constructor(props) {
        const baseTranslations = {
            en: require('./i18n/en.json'),
            de: require('./i18n/de.json'),
            ru: require('./i18n/ru.json'),
            pt: require('./i18n/pt.json'),
            nl: require('./i18n/nl.json'),
            fr: require('./i18n/fr.json'),
            it: require('./i18n/it.json'),
            es: require('./i18n/es.json'),
            pl: require('./i18n/pl.json'),
            'zh-cn': require('./i18n/zh-cn.json'),
        };

        const additionalTranslations = {
            uk: require('./i18n/uk.json'),
        };

        const extendedProps = {
            ...props,
            encryptedFields: [],
            translations: baseTranslations,
        };
        super(props, extendedProps);

        Object.entries(additionalTranslations).forEach(([lang, words]) => {
            if (!baseTranslations[lang]) {
                I18n.extendTranslations(words, lang);
            }
        });
    }

    onConnectionReady() {
        // executed when connection is ready
    }

    render() {
        if (!this.state.loaded) {
            return super.render();
        }

        return (
            <div className="App">
                <Settings native={this.state.native} onChange={(attr, value) => this.updateNativeValue(attr, value)} />
                {this.renderError()}
                {this.renderToast()}
                {this.renderSaveCloseButtons()}
            </div>
        );
    }
}

export default withStyles(styles)(App);
