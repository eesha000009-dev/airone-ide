/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { AiroCompilerService } from './airo-compiler-service';
import { AiroSerialService } from './airo-serial-service';
import { AiroSketchService } from './airo-sketch-service';
import {
    AiroSketchClient,
    AiroSerialClient,
    AIRO_SKETCH_PATH,
    AIRO_SERIAL_PATH
} from '../common/airo-protocol';

export default new ContainerModule(bind => {
    // ─── Backend Services ────────────────────────────────────────────────

    bind(AiroCompilerService).toSelf().inSingletonScope();
    bind(AiroSerialService).toSelf().inSingletonScope();
    bind(AiroSketchService).toSelf().inSingletonScope();

    // ─── RPC Connection Handlers ─────────────────────────────────────────

    bind(ConnectionHandler).toDynamicValue(ctx =>
        new JsonRpcConnectionHandler<AiroSketchClient>(
            AIRO_SKETCH_PATH,
            () => ctx.container.get<AiroSketchService>(AiroSketchService)
        )
    ).inSingletonScope();

    bind(ConnectionHandler).toDynamicValue(ctx =>
        new JsonRpcConnectionHandler<AiroSerialClient>(
            AIRO_SERIAL_PATH,
            () => ctx.container.get<AiroSerialService>(AiroSerialService)
        )
    ).inSingletonScope();
});
