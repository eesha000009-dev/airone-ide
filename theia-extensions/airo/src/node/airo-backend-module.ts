/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Airone Proprietary License, which is available in the project root.
 *
 * SPDX-License-Identifier: Proprietary
 ********************************************************************************/

import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { AiroCompilerService } from './airo-compiler-service';
import { AiroBuiltInCompiler } from './airo-built-in-compiler';
import { AiroTranspiler } from './airo-transpiler';
import { AiroSerialService } from './airo-serial-service';
import { AiroSketchService } from './airo-sketch-service';
import { AiroUploadService } from './airo-upload-service';
import {
    AiroSketchClient,
    AiroSerialClient,
    AiroUploadClient,
    AIRO_SKETCH_PATH,
    AIRO_SERIAL_PATH,
    AIRO_UPLOAD_PATH
} from '../common/airo-protocol';

export default new ContainerModule(bind => {
    // ─── Backend Services ────────────────────────────────────────────────

    // Built-in TypeScript compiler (always available, no Python needed)
    bind(AiroBuiltInCompiler).toSelf().inSingletonScope();

    // .airo → C++ transpiler (always available, no external dependencies)
    bind(AiroTranspiler).toSelf().inSingletonScope();

    // Main compiler service (3-step pipeline: syntax check → transpile → PlatformIO build)
    bind(AiroCompilerService).toSelf().inSingletonScope();

    bind(AiroSerialService).toSelf().inSingletonScope();
    bind(AiroSketchService).toSelf().inSingletonScope();
    bind(AiroUploadService).toSelf().inSingletonScope();

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

    bind(ConnectionHandler).toDynamicValue(ctx =>
        new JsonRpcConnectionHandler<AiroUploadClient>(
            AIRO_UPLOAD_PATH,
            () => ctx.container.get<AiroUploadService>(AiroUploadService)
        )
    ).inSingletonScope();
});
