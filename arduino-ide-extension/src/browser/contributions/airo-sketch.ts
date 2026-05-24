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

@injectable()
export class AiroSketch extends SketchContribution {
  override registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(AiroSketch.Commands.NEW_AIRO_SKETCH, {
      execute: () => this.newAiroSketch(),
    });
  }

  override registerMenus(registry: MenuModelRegistry): void {
    registry.registerMenuAction(ArduinoMenus.FILE__SKETCH_GROUP, {
      commandId: AiroSketch.Commands.NEW_AIRO_SKETCH.id,
      label: nls.localize(
        'arduino/airo/newRobot',
        'New Airone Robot'
      ),
      order: '1',
    });
  }

  override registerKeybindings(registry: KeybindingRegistry): void {
    registry.registerKeybinding({
      command: AiroSketch.Commands.NEW_AIRO_SKETCH.id,
      keybinding: 'CtrlCmd+Shift+N',
    });
  }

  async newAiroSketch(): Promise<void> {
    try {
      const sketch = await this.sketchesService.createNewAiroSketch();
      this.workspaceService.open(new URI(sketch.uri));
    } catch (e) {
      await this.messageService.error(e.toString());
    }
  }
}

export namespace AiroSketch {
  export namespace Commands {
    export const NEW_AIRO_SKETCH: Command = {
      id: 'arduino-airo.newSketch',
    };
  }
}
