/*
 * tspSupplemental.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Pyright-specific supplemental extensions to the Type Server Protocol (TSP).
 *
 * These notifications are NOT part of the base TSP (defined in typeServerProtocol.ts),
 * which is shared by all TSP implementers (e.g., ty-tsp). This file defines
 * Pyright-only extensions that require Pyright-specific knowledge (e.g., the
 * VirtualFileOverlayFileSystem in PylanceFileSystem).
 *
 * All the types in this file should be JSON serializable, as they are sent over the wire.
 */
import { MessageDirection, ProtocolNotificationType } from 'vscode-languageserver-protocol';

export namespace TspSupplemental {
    /**
     * Parameters for the setVirtualFileRedirect notification.
     */
    export interface SetVirtualFileRedirectParams {
        /** The URI of the real file (as seen by the editor / VS Code). */
        realUri: string;
        /** The URI of the virtual file on disk that should be read instead. */
        virtualUri: string;
    }

    /**
     * Parameters for the removeVirtualFileRedirect notification.
     */
    export interface RemoveVirtualFileRedirectParams {
        /** The URI of the real file whose redirect should be removed. */
        realUri: string;
    }

    /**
     * Notification sent by the client (Pylance) to the type server to register a virtual
     * file redirect. After receiving this notification, the type server's file system
     * should redirect reads for `realUri` to `virtualUri`.
     *
     * This is used by the Django stub generation feature: Pylance's Rust sidecar writes
     * merged virtual `.py` files to disk, and this notification tells the type server's
     * VirtualFileOverlayFileSystem to redirect reads so Pyright analyzes the virtual content.
     */
    export namespace SetVirtualFileRedirectNotification {
        export const method = 'pyright/setVirtualFileRedirect' as const;
        export const messageDirection = MessageDirection.clientToServer;
        export const type = new ProtocolNotificationType<SetVirtualFileRedirectParams, void>(method);
    }

    /**
     * Notification sent by the client (Pylance) to the type server to remove a previously
     * registered virtual file redirect. After receiving this notification, the type server's
     * file system should read the real file again for the given URI.
     */
    export namespace RemoveVirtualFileRedirectNotification {
        export const method = 'pyright/removeVirtualFileRedirect' as const;
        export const messageDirection = MessageDirection.clientToServer;
        export const type = new ProtocolNotificationType<RemoveVirtualFileRedirectParams, void>(method);
    }
}
