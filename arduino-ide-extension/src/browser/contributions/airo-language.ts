import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { injectable } from '@theia/core/shared/inversify';
import { SketchContribution, URI } from './contribution';
import { CurrentSketch } from '../sketches-service-client-impl';

/**
 * Airo Language contribution.
 *
 * This contribution manages language features for .airo files.
 * It skips the C++ language server (clangd) for .airo sketches and
 * could be extended in the future with a proper .airo language server.
 */
@injectable()
export class AiroLanguage extends SketchContribution {
  private readonly toDispose = new DisposableCollection();

  override onReady(): void {
    // Listen for sketch changes to detect .airo files
    this.toDispose.push(
      this.sketchServiceClient.onCurrentSketchDidChange(
        (sketch: CurrentSketch) => {
          if (CurrentSketch.isValid(sketch)) {
            const isAiro = this.isAiroSketch(sketch.mainFileUri);
            if (isAiro) {
              // Stop the C++ language server for .airo sketches
              this.commandService
                .executeCommand('arduino.languageserver.stop')
                .then(() => {
                  console.info(
                    'Stopped C++ language server for .airo sketch.'
                  );
                })
                .catch((e: unknown) => {
                  console.debug(
                    'Could not stop language server for .airo sketch.',
                    e
                  );
                });
            }
          }
        }
      )
    );
  }

  onStop(): void {
    this.toDispose.dispose();
  }

  /**
   * Checks if the given URI points to a .airo file.
   */
  private isAiroSketch(mainFileUri: string): boolean {
    const uri =
      typeof mainFileUri === 'string' ? new URI(mainFileUri) : mainFileUri;
    return uri.path.base.endsWith('.airo');
  }
}
