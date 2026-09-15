import { NotFoundException } from '@nestjs/common';

jest.mock('@gitroom/nestjs-libraries/dtos/posts/create.post.dto', () => ({
  CreatePostDto: class CreatePostDto {},
}));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class IntegrationManager {},
}));

import { PostsService } from './posts.service';

describe('PostsService.getPost by id (OMN-185)', () => {
  test('uses one organization-scoped lookup and returns the post group', async () => {
    const post = {
      id: 'post-1',
      group: 'group-1',
      integrationId: 'channel-1',
      integration: { picture: 'picture.png' },
      childrenPost: [],
      image: '[]',
      settings: '{}',
    };
    const getPost = jest.fn().mockResolvedValue(post);
    const service = Object.create(PostsService.prototype) as any;
    service._postRepository = { getPost };
    service.updateMedia = jest.fn().mockResolvedValue([]);

    await expect(service.getPost('org-1', 'post-1')).resolves.toMatchObject({
      group: 'group-1',
      integration: 'channel-1',
      posts: [{ id: 'post-1' }],
    });
    expect(getPost).toHaveBeenCalledTimes(1);
    expect(getPost).toHaveBeenCalledWith('post-1', true, 'org-1', true);
  });

  test('answers 404 when the id is not in the organization', async () => {
    const service = Object.create(PostsService.prototype) as any;
    service._postRepository = { getPost: jest.fn().mockResolvedValue(null) };

    await expect(
      service.getPost('org-1', 'other-org-post')
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
