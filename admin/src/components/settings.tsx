import React, { type ChangeEvent } from 'react';
import { withStyles, createStyles, type WithStyles } from '@material-ui/core/styles';
import TextField, { type TextFieldProps } from '@material-ui/core/TextField';
import I18n from '@iobroker/adapter-react/i18n';

const styles = () =>
    createStyles({
        tab: {
            maxWidth: 600,
            padding: 10,
        },
        input: {
            marginTop: 0,
            width: '100%',
            maxWidth: 600,
        },
        controlElement: {
            marginBottom: 16,
        },
    });

type SettingsProps = WithStyles<typeof styles> & {
    native: ioBroker.AdapterConfig;
    onChange: <K extends keyof ioBroker.AdapterConfig>(attr: K, value: ioBroker.AdapterConfig[K]) => void;
};

type SettingsState = Record<string, never>;

class Settings extends React.Component<SettingsProps, SettingsState> {
    public constructor(props: SettingsProps) {
        super(props);
        this.state = {};
    }

    private renderInput<K extends keyof ioBroker.AdapterConfig>(
        title: AdminWord,
        attr: K,
        type: TextFieldProps['type'],
        additionalProps: Partial<TextFieldProps> = {},
    ): React.ReactNode {
        const { classes, native } = this.props;
        const value = (native[attr] ?? '') as string;

        return (
            <TextField
                label={I18n.t(title)}
                className={`${classes.input} ${classes.controlElement}`}
                value={value}
                type={type ?? 'text'}
                onChange={(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                    const nextValue = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
                    this.props.onChange(attr, nextValue as ioBroker.AdapterConfig[K]);
                }}
                margin="normal"
                fullWidth
                {...additionalProps}
            />
        );
    }

    public render(): React.ReactNode {
        const { classes } = this.props;

        return (
            <form className={classes.tab}>
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
