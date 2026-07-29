<?php
require_once __DIR__ . '/php/includes/bootstrap.php';
require_login();
if (!can_edit()) { header('Location: dashboard.php'); exit; }

$mode = 'create';
page_head('Créer une séance', ['session.css', 'pdf.css']);
app_shell_open('create');
include __DIR__ . '/php/includes/session_editor.php';
echo '<script>window.SESSION_ID=null;window.EDITOR_MODE="create";</script>';
app_shell_close([
    'app.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    'pdf-generator.js',
    'session.js',
]);
