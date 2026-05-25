/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { ContainerModule } from '@theia/core/shared/inversify';
import { AiroCompilerService } from './airo-compiler-service';
import { AiroSerialService } from './airo-serial-service';

export default new ContainerModule(bind => {
    bind(AiroCompilerService).toSelf().inSingletonScope();
    bind(AiroSerialService).toSelf().inSingletonScope();
});
