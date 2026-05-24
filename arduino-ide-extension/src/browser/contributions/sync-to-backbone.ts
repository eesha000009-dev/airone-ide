import { nls } from '@theia/core/lib/common';
import { injectable } from '@theia/core/shared/inversify';
import { ArduinoMenus } from '../menu/arduino-menus';
import {
  SketchContribution,
  URI,
  Command,
  CommandRegistry,
  MenuModelRegistry,
  KeybindingRegistry,
} from './contribution';
import { CurrentSketch } from '../sketches-service-client-impl';
import { Sketch } from '../../common/protocol';

/**
 * Sync to Backbone contribution.
 *
 * Sends the pin defi block from the current .airo sketch
 * to the AI Backbone app (URL configured via AIRO_BACKBONE_URL environment variable)
 * via HTTP POST.
 */
@injectable()
export class SyncToBackbone extends SketchContribution {
  override registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(SyncToBackbone.Commands.SYNC_TO_BACKBONE, {
      execute: () => this.syncToBackbone(),
      isEnabled: () => this.isAiroSketch(),
    });
  }

  override registerMenus(registry: MenuModelRegistry): void {
    registry.registerMenuAction(ArduinoMenus.SKETCH__UTILS_GROUP, {
      commandId: SyncToBackbone.Commands.SYNC_TO_BACKBONE.id,
      label: nls.localize(
        'arduino/airo/syncToBackbone',
        'Sync to Airone Backbone'
      ),
      order: '10',
    });
  }

  override registerKeybindings(registry: KeybindingRegistry): void {
    registry.registerKeybinding({
      command: SyncToBackbone.Commands.SYNC_TO_BACKBONE.id,
      keybinding: 'CtrlCmd+Shift+B',
    });
  }

  private isAiroSketch(): boolean {
    const sketch = this.sketchServiceClient.tryGetCurrentSketch();
    if (!CurrentSketch.isValid(sketch)) {
      return false;
    }
    return sketch.mainFileUri.endsWith('.airo');
  }

  private async syncToBackbone(): Promise<void> {
    const sketch = await this.sketchServiceClient.currentSketch();
    if (!CurrentSketch.isValid(sketch)) {
      return;
    }

    // Get the .airo source content
    const airoCode = await this.getAiroSourceCode(sketch);
    if (!airoCode) {
      this.messageService.error(
        nls.localize(
          'arduino/airo/noSourceForSync',
          'Could not read .airo source for sync.'
        )
      );
      return;
    }

    // Extract pin defi block
    const pinDefi = this.extractPinDefi(airoCode);
    if (!pinDefi) {
      this.messageService.warn(
        nls.localize(
          'arduino/airo/noPinDefi',
          'No pin defi block found in .airo file.'
        )
      );
      return;
    }

    // Send to backbone — URL must be configured via AIRO_BACKBONE_URL env var
    // or via the Airone Backbone app's settings. If not configured, show an error.
    const backboneUrl = process.env.AIRO_BACKBONE_URL;
    if (!backboneUrl) {
      this.messageService.error(
        nls.localize(
          'arduino/airo/noBackboneUrl',
          'No Airone Backbone URL configured. Set the AIRO_BACKBONE_URL environment variable or start the Backbone app first.'
        )
      );
      return;
    }

    try {
      const response = await fetch(`${backboneUrl}/api/pins/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          robotName: sketch.name,
          pinDefinitions: pinDefi,
          source: airoCode,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      this.messageService.info(
        nls.localize(
          'arduino/airo/syncSuccess',
          'Pin definitions synced to Airone Backbone.'
        ),
        { timeout: 3000 }
      );
    } catch (err) {
      this.messageService.error(
        nls.localize(
          'arduino/airo/syncFailed',
          'Failed to sync to Backbone: {0}',
          err instanceof Error ? err.message : String(err)
        )
      );
    }
  }

  private async getAiroSourceCode(
    sketch: Sketch
  ): Promise<string | undefined> {
    for (const editor of this.editorManager.all) {
      const uri = editor.editor.uri;
      if (uri.path.base.endsWith('.airo') && Sketch.isInSketch(uri, sketch)) {
        return editor.editor.document.getText();
      }
    }
    // Read from file
    for (const uriStr of [
      sketch.mainFileUri,
      ...sketch.otherSketchFileUris,
    ]) {
      if (uriStr.endsWith('.airo')) {
        try {
          const uri = new URI(uriStr);
          const content = await this.fileService.read(uri);
          return content.value;
        } catch {
          // Ignore
        }
      }
    }
    return undefined;
  }

  private extractPinDefi(source: string): string | undefined {
    const match = source.match(/pin\s+defi\s*\{[\s\S]*?\}/);
    return match ? match[0] : undefined;
  }
}

export namespace SyncToBackbone {
  export namespace Commands {
    export const SYNC_TO_BACKBONE: Command = {
      id: 'arduino-airo.syncToBackbone',
    };
  }
}
