import React from 'react';
import { withStyles } from '@material-ui/core/styles';
import TextField from '@material-ui/core/TextField';
import I18n from '@iobroker/adapter-react/i18n';

/**
 * @type {() => Record<string, import("@material-ui/core/styles/withStyles").CreateCSSProperties>}
 */
const styles = () => ({
    tab: {
        maxWidth: 600,
    },
    input: {
        marginTop: 0,
        width: '100%',
        maxWidth: 600,
    },
    controlElement: {
        //background: "#d2d2d2",
        marginBottom: 5,
    },
});

/**
 * @typedef {object} SettingsProps
 * @property {Record<string, string>} classes
 * @property {Record<string, any>} native
 * @property {(attr: string, value: any) => void} onChange
 */

/**
 * @typedef {object} SettingsState
 * @property {undefined} [dummy] Delete this and add your own state properties here
 */

/**
 * @extends {React.Component<SettingsProps, SettingsState>}
 */
class Settings extends React.Component {
    constructor(props) {
        super(props);
        this.state = {};
    }

    /**
     * @param {AdminWord} title
     * @param {string} attr
     * @param {string} type
     */
    renderInput(title, attr, type, additionalProps = {}) {
        return (
            <TextField
                label={I18n.t(title)}
                className={`${this.props.classes.input} ${this.props.classes.controlElement}`}
                value={this.props.native[attr] !== undefined ? this.props.native[attr] : ''}
                type={type || 'text'}
                onChange={(e) => this.props.onChange(attr, e.target.value)}
                margin="normal"
                fullWidth
                {...additionalProps}
            />
        );
    }

    render() {
        return (
            <form className={this.props.classes.tab}>
                {this.renderInput('baseUrl', 'baseUrl', 'text', {
                    required: true,
                    helperText: I18n.t('baseUrl_help'),
                })}
                {this.renderInput('apiToken', 'apiToken', 'password', {
                    required: true,
                    helperText: I18n.t('apiToken_help'),
                    autoComplete: 'off',
                })}
            </form>
        );
    }
}

export default withStyles(styles)(Settings);
