/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import * as React from 'react';

import { Message } from '@theia/core/lib/browser';
import { PreferenceService } from '@theia/core/lib/common';
import { inject, injectable } from '@theia/core/shared/inversify';
import {
    renderDocumentation, renderDownloads, renderExtendingCustomizing, renderProductName, renderSourceCode, renderSupport, renderTickets, renderWhatIs, renderCollaboration
} from './branding-util';

import { GettingStartedWidget } from '@theia/getting-started/lib/browser/getting-started-widget';
import { VSXEnvironment } from '@theia/vsx-registry/lib/common/vsx-environment';
import { WindowService } from '@theia/core/lib/browser/window/window-service';

/**
 * Custom Getting Started widget for Airone IDE.
 *
 * The welcome page is DISABLED by default — Airone opens directly into the
 * editor with a default sketch. The GettingStarted widget is kept registered
 * so users can still access it via the Help menu, but it auto-closes on
 * startup so the editor is the primary view.
 *
 * When opened manually (Help → Welcome), the full welcome page renders.
 */
@injectable()
export class TheiaIDEGettingStartedWidget extends GettingStartedWidget {

    @inject(VSXEnvironment)
    protected readonly environment: VSXEnvironment;

    @inject(WindowService)
    protected readonly windowService: WindowService;

    @inject(PreferenceService)
    protected readonly preferenceService: PreferenceService;

    protected vscodeApiVersion: string;

    /** Whether this widget is being auto-opened on startup (should close immediately) */
    protected isAutoOpened = true;

    protected async doInit(): Promise<void> {
        super.doInit();
        this.vscodeApiVersion = await this.environment.getVscodeApiVersion();
        await this.preferenceService.ready;
        this.update();

        // If this was auto-opened on startup, close it immediately so the
        // editor area shows instead of the welcome page.
        // The AiroContribution will create a default sketch after this.
        if (this.isAutoOpened) {
            this.isAutoOpened = false;
            // Delay close slightly to let the shell finish layout
            setTimeout(() => {
                try {
                    this.close();
                } catch { /* widget may already be disposed */ }
            }, 100);
        }
    }

    protected onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        // When opened manually (not on startup), show the full welcome page
        this.isAutoOpened = false;
        const htmlElement = document.getElementById('alwaysShowWelcomePage');
        if (htmlElement) {
            htmlElement.focus();
        }
    }

    protected render(): React.ReactNode {
        // If auto-opened on startup, render nothing (will close immediately)
        if (this.isAutoOpened) {
            return <div style={{ display: 'none' }} />;
        }

        // Full welcome page when opened manually via Help menu
        return <div className='gs-container'>
            <div className='gs-content-container'>
                <div className='gs-float'>
                    <div className='gs-logo'>
                    </div>
                    {this.renderActions()}
                </div>
                {this.renderHeader()}
                <hr className='gs-hr' />
                <div className='flex-grid'>
                    <div className='col'>
                        {renderWhatIs(this.windowService)}
                    </div>
                </div>
                <div className='flex-grid'>
                    <div className='col'>
                        {renderExtendingCustomizing(this.windowService)}
                    </div>
                </div>
                <div className='flex-grid'>
                    <div className='col'>
                        {renderSupport(this.windowService)}
                    </div>
                </div>
                <div className='flex-grid'>
                    <div className='col'>
                        {renderTickets(this.windowService)}
                    </div>
                </div>
                <div className='flex-grid'>
                    <div className='col'>
                        {renderSourceCode(this.windowService)}
                    </div>
                </div>
                <div className='flex-grid'>
                    <div className='col'>
                        {renderDocumentation(this.windowService)}
                    </div>
                </div>
                <div className='flex-grid'>
                    <div className='col'>
                        {renderCollaboration(this.windowService)}
                    </div>
                </div>
                <div className='flex-grid'>
                    <div className='col'>
                        {renderDownloads()}
                    </div>
                </div>
            </div>
            <div className='gs-preference-container'>
                {this.renderPreferences()}
            </div>
        </div>;
    }

    protected renderActions(): React.ReactNode {
        return <div className='gs-container'>
            <div className='flex-grid'>
                <div className='col'>
                    {this.renderStart()}
                </div>
            </div>
            <div className='flex-grid'>
                <div className='col'>
                    {this.renderRecentWorkspaces()}
                </div>
            </div>
            <div className='flex-grid'>
                <div className='col'>
                    {this.renderSettings()}
                </div>
            </div>
            <div className='flex-grid'>
                <div className='col'>
                    {this.renderHelp()}
                </div>
            </div>
        </div>;
    }

    protected renderHeader(): React.ReactNode {
        return <div className='gs-header'>
            {renderProductName()}
            {this.renderVersion()}
        </div>;
    }

    protected renderVersion(): React.ReactNode {
        return <div>
            <p className='gs-sub-header' >
                {this.applicationInfo ? 'Airone IDE Version ' + this.applicationInfo.version : '-'}
            </p>

            <p className='gs-sub-header' style={{ fontSize: '0.9em', opacity: 0.7 }} >
                {'VS Code API Version: ' + this.vscodeApiVersion}
            </p>
        </div>;
    }
}
