import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeploymentChecklist } from './entities/deployment-checklist.entity';
import { DeploymentChecklistStatus } from './entities/deployment-checklist-status.entity';

@Injectable()
export class DeploymentService {
  constructor(
    @InjectRepository(DeploymentChecklist)
    private checklistRepository: Repository<DeploymentChecklist>,
    @InjectRepository(DeploymentChecklistStatus)
    private checklistStatusRepository: Repository<DeploymentChecklistStatus>,
  ) {}

  async getChecklist(category?: string) {
    const where: any = {};
    if (category) {
      where.category = category;
    }

    return this.checklistRepository.find({
      where,
      relations: ['statuses'],
      order: { priority: 'DESC', itemName: 'ASC' },
    });
  }

  async getChecklistWithLatestStatus() {
    const items = await this.checklistRepository.find({
      order: { priority: 'DESC', itemName: 'ASC' },
    });

    const itemsWithStatus = await Promise.all(
      items.map(async (item) => {
        const latestStatus = await this.checklistStatusRepository.findOne({
          where: { checklistItemId: item.id },
          order: { checkedAt: 'DESC' },
        });

        return {
          ...item,
          latestStatus,
        };
      }),
    );

    return itemsWithStatus;
  }

  async getDeploymentStatus() {
    const allItems = await this.checklistRepository.find();
    const requiredItems = allItems.filter((item) => item.isRequired);

    const itemsWithStatus = await Promise.all(
      allItems.map(async (item) => {
        const latestStatus = await this.checklistStatusRepository.findOne({
          where: { checklistItemId: item.id },
          order: { checkedAt: 'DESC' },
        });

        return {
          item,
          status: latestStatus,
        };
      }),
    );

    const totalItems = allItems.length;
    const requiredItemsCount = requiredItems.length;
    const completedItems = itemsWithStatus.filter(
      (i) => i.status?.status === true,
    ).length;
    const completedRequiredItems = itemsWithStatus.filter(
      (i) => i.item.isRequired && i.status?.status === true,
    ).length;

    const readyForDeployment = completedRequiredItems === requiredItemsCount;
    const completionPercentage = (completedItems / totalItems) * 100;

    return {
      readyForDeployment,
      totalItems,
      completedItems,
      requiredItems: requiredItemsCount,
      completedRequiredItems,
      completionPercentage: parseFloat(completionPercentage.toFixed(2)),
      itemsByCategory: await this.getItemsByCategory(),
    };
  }

  async getItemsByCategory() {
    const items = await this.getChecklistWithLatestStatus();

    const categories = [...new Set(items.map((item) => item.category))];

    return categories.map((category) => {
      const categoryItems = items.filter((item) => item.category === category);
      const completed = categoryItems.filter(
        (item) => item.latestStatus?.status === true,
      ).length;

      return {
        category,
        total: categoryItems.length,
        completed,
        items: categoryItems,
      };
    });
  }

  async updateChecklistStatus(
    itemId: number,
    status: boolean,
    checkedBy: string,
    notes?: string,
    evidenceUrl?: string,
  ) {
    const item = await this.checklistRepository.findOne({
      where: { id: itemId },
    });

    if (!item) {
      throw new NotFoundException(`Checklist item with ID ${itemId} not found`);
    }

    const checklistStatus = this.checklistStatusRepository.create({
      checklistItemId: itemId,
      status,
      checkedBy,
      notes,
      evidenceUrl,
      checkedAt: new Date(),
    });

    return this.checklistStatusRepository.save(checklistStatus);
  }
}
