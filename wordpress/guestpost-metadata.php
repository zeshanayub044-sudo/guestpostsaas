<?php
/**
 * Plugin Name: GuestPost Editorial Metadata
 * Description: Authorized REST metadata and front-end title/description support for GuestPost.
 * Version: 1.0.0
 * Requires PHP: 7.4
 */
defined('ABSPATH') || exit;
add_action('init', function () {
  foreach (array('guestpost_meta_title', 'guestpost_meta_description', 'guestpost_focus_keyword') as $key) {
    register_post_meta('post', $key, array(
      'type' => 'string', 'single' => true, 'show_in_rest' => true,
      'sanitize_callback' => 'sanitize_text_field',
      'auth_callback' => function () { return current_user_can('edit_posts'); },
    ));
  }
});
add_filter('pre_get_document_title', function ($title) {
  if (is_singular('post')) {
    $custom = get_post_meta(get_queried_object_id(), 'guestpost_meta_title', true);
    if ($custom) return $custom;
  }
  return $title;
});
add_action('wp_head', function () {
  if (!is_singular('post')) return;
  $description = get_post_meta(get_queried_object_id(), 'guestpost_meta_description', true);
  if ($description) echo '<meta name="description" content="' . esc_attr($description) . '">' . "\n";
}, 1);
