<?php

namespace Drupal\guestpost_permissions\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\node\Entity\Node;
use Drupal\filter\Entity\FilterFormat;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

final class CapabilitiesController extends ControllerBase {
  public function check(Request $request): JsonResponse {
    $account = $this->currentUser();
    $bundle = (string) $request->query->get('bundle', 'article');
    $format = (string) $request->query->get('text_format', 'basic_html');
    if (!preg_match('/^[a-z0-9_]{1,64}$/', $bundle) || !preg_match('/^[a-z0-9_]{1,64}$/', $format)) {
      return new JsonResponse(['error' => 'Invalid content configuration'], 400);
    }
    if (!$this->entityTypeManager()->getStorage('node_type')->load($bundle)) {
      return new JsonResponse(['error' => 'Unknown content type'], 400);
    }
    $node = Node::create(['type' => $bundle, 'uid' => $account->id(), 'title' => 'GuestPost permission check', 'status' => 1]);
    $create = $this->entityTypeManager()->getAccessControlHandler('node')->createAccess($bundle, $account, [], TRUE)->isAllowed();
    $format_entity = FilterFormat::load($format);
    $body_allowed = !$node->hasField('body') || ($node->get('body')->access('edit', $account, TRUE)->isAllowed() && $format_entity && $format_entity->access('use', $account));
    $publish = $node->get('status')->access('edit', $account, TRUE)->isAllowed();
    $moderated = $this->moduleHandler()->moduleExists('content_moderation') && \Drupal::service('content_moderation.moderation_information')->isModeratedEntity($node);
    $writes = !\Drupal::config('jsonapi.settings')->get('read_only');
    // No node is saved and no workflow transition is attempted.
    $response = new JsonResponse(['protocol' => 'guestpost.permissions.v1', 'platform' => 'drupal', 'authenticated' => $account->isAuthenticated(), 'account_id' => (string) $account->id(), 'bundle' => $bundle, 'text_format' => $format, 'permissions' => ['create' => $create && $body_allowed && $writes, 'publish' => $publish && !$moderated && $writes], 'workflow_requires_configuration' => $moderated]);
    $response->headers->set('Cache-Control', 'private, no-store');
    return $response;
  }
}
