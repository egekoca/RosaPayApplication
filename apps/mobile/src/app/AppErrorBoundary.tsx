import React, {type ErrorInfo, type ReactNode} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {Button, colors, spacing, typography} from '@rosapay/ui';
import {logger} from '../shared/logger';

type Props = {children: ReactNode};
type State = {hasError: boolean};

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = {hasError: false};

  static getDerivedStateFromError(): State {
    return {hasError: true};
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error('app_render_failed', {message: error.message, componentStack: info.componentStack});
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Lumenade Pay needs a fresh start</Text>
          <Text style={styles.body}>Your wallet and payment authorization were not changed.</Text>
          <Button onPress={() => this.setState({hasError: false})}>Try again</Button>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {flex: 1, justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.canvas, gap: spacing.lg},
  title: {...typography.title, color: colors.ink},
  body: {...typography.body, color: colors.inkMuted},
});
